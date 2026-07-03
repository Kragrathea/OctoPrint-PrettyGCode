import * as THREE from '../three-exports.js'
import { arcOffsetFromRadius, interpolateArc } from './arc-interpolation.js'

// Initial machine state
const INITIAL_MACHINE_STATE = Object.freeze({ x: 0, y: 0, z: 0, e: 0, f: 0 })

// Feedrate (mm/min) to mm/s, with a sane pace for moves before any F word is seen
const feedrateMmPerSecond = (feedrate) => (feedrate > 0 ? feedrate : 1500) / 60

// OctoPrint's filepos counts bytes, so lines with non-ASCII characters need real encoding
const NON_ASCII = /[\u0080-\uffff]/
const textEncoder = new TextEncoder()

// Z steps smaller than this stay in the same layer: vase mode rises continuously and would split a layer per segment
const LAYER_EPSILON_MM = 0.04

// Colors for slicer feature types; the first keyword found in a comment wins.
const DEFAULT_COLOR = new THREE.Color('white')
const COLOR_KEYWORDS = [
  ['inner', 'green'],
  ['outer', 'red'],
  ['perimeter', 'red'],
  ['fill', 'orange'],
  ['skin', 'yellow'],
  ['support', 'skyblue'],
  ['skirt', 'skyblue']
]

// Nozzle diameter stated by the slicer, e.g. "; nozzle_diameter = 0.4"
const NOZZLE_DIAMETER_COMMENT = /nozzle[_ ]?diameter\s*[:=]\s*([\d.]+)/i

// Reused across addSegment to avoid per-segment allocations
const scratchDirection = new THREE.Vector3()
const scratchColor = new THREE.Color()
const scratchHsl = {}

export class GCodeParser {
  // Parsed layers: segment endpoints, colors, file positions and estimated durations
  layers = []

  // Bounding box of the extruded gcode
  bounds = new THREE.Box3()

  // Nozzle diameter the slicer states, if any
  slicerNozzleDiameter = null

  // Parsing states
  machineState = INITIAL_MACHINE_STATE
  currentLayer = null
  currentColor = DEFAULT_COLOR
  pendingLine = ''
  filePosition = 0
  pendingTravelSeconds = 0
  axesRelative = false
  extrusionRelative = false

  parse (chunk) {
    // Chunks may split a line in two: prepend last call's leftover, hold the new trailing partial for next time
    const lines = chunk.split('\n')
    lines[0] = this.pendingLine + lines[0]
    this.pendingLine = lines[lines.length - 1]

    for (let i = 0; i < lines.length - 1; i++) {
      // Get the line
      const rawLine = lines[i]
      this.filePosition += (NON_ASCII.test(rawLine) ? textEncoder.encode(rawLine).length : rawLine.length) + 1

      if (rawLine.includes(';')) {
        const commentLower = rawLine.toLowerCase()

        // Pick the color based on the feature type
        const match = COLOR_KEYWORDS.find(([keyword]) => commentLower.includes(keyword))
        if (match) this.currentColor = new THREE.Color(match[1])

        // First nozzle diameter the slicer states wins
        if (this.slicerNozzleDiameter == null) {
          const nozzleMatch = commentLower.match(NOZZLE_DIAMETER_COMMENT)
          if (nozzleMatch) this.slicerNozzleDiameter = parseFloat(nozzleMatch[1])
        }
      }

      // Parse gcode cmd and args
      const tokens = rawLine.replace(/;.*/, '').trim().split(/\s+/)
      const cmd = tokens[0].toUpperCase()
      const args = {}
      tokens.slice(1).forEach((token) => {
        if (token) args[token[0].toLowerCase()] = parseFloat(token.substring(1))
      })

      // Axis value from args (absolute/relative aware), or the current one if omitted
      const coord = (key) => {
        if (args[key] === undefined) return this.machineState[key]
        if (key === 'f') return args.f
        const relative = key === 'e' ? this.extrusionRelative : this.axesRelative
        return relative ? this.machineState[key] + args[key] : args[key]
      }

      switch (cmd) {
        // Linear move
        case 'G0':
        case 'G1': {
          const move = { x: coord('x'), y: coord('y'), z: coord('z'), e: coord('e'), f: coord('f') }

          // New layer only when extrusion climbs to a higher Z
          if (this.extrusionDelta(args, move) > 0 && (this.currentLayer == null || move.z > this.currentLayer.z + LAYER_EPSILON_MM)) {
            this.newLayer(move)
          }

          // Extrude a segment when E is present, otherwise track the travel time
          if (args.e !== undefined) this.addSegment(this.machineState, move)
          else this.addTravel(this.machineState, move)
          this.machineState = move
          break
        }
        // Arc move (G2 clockwise, G3 counter-clockwise)
        case 'G2':
        case 'G3': {
          const move = {
            x: coord('x'),
            y: coord('y'),
            z: coord('z'),
            e: coord('e'), // extruder position
            f: coord('f') // feedrate
          }

          // New layer only when extrusion climbs to a higher Z
          if (this.extrusionDelta(args, move) > 0 && (this.currentLayer == null || move.z > this.currentLayer.z + LAYER_EPSILON_MM)) {
            this.newLayer(move)
          }

          // Center offset from the I/J words, or computed from the radius of an R-form arc
          const offset = args.r !== undefined
            ? arcOffsetFromRadius(this.machineState, move, args.r, cmd === 'G2')
            : { i: args.i ?? 0, j: args.j ?? 0 }

          // Arcs with K, or an R that gives no usable center, fall back to a straight segment
          // so the next moves still start from the right point
          if (args.k !== undefined || (args.r !== undefined && !offset.i && !offset.j)) {
            console.warn('PrettyGCode: Unsupported arc', rawLine)
            if (args.e !== undefined) this.addSegment(this.machineState, move)
            else this.addTravel(this.machineState, move)
            this.machineState = move
            break
          }

          // Split the arc into straight segments
          const arc = {
            ...move,
            i: offset.i, // X offset from start to arc center
            j: offset.j, // Y offset from start to arc center
            is_clockwise: cmd === 'G2'
          }
          const segments = interpolateArc(this.machineState, arc)
          for (let segmentIndex = 1; segmentIndex < segments.length; segmentIndex++) {
            if (args.e !== undefined) this.addSegment(segments[segmentIndex - 1], segments[segmentIndex])
            else this.addTravel(segments[segmentIndex - 1], segments[segmentIndex])
          }
          this.machineState = segments[segments.length - 1]
          break
        }
        // Dwell: the pause adds to the time of the travel toward the next segment
        case 'G4':
          this.pendingTravelSeconds += (args.s || 0) + (args.p || 0) / 1000
          break
        // Home: the named axes (all of them if none is given) end up at the origin
        case 'G28': {
          const all = args.x === undefined && args.y === undefined && args.z === undefined
          this.machineState = {
            ...this.machineState,
            x: all || args.x !== undefined ? 0 : this.machineState.x,
            y: all || args.y !== undefined ? 0 : this.machineState.y,
            z: all || args.z !== undefined ? 0 : this.machineState.z
          }
          break
        }
        // Absolute positioning
        case 'G90':
          this.axesRelative = false
          this.extrusionRelative = false
          break
          // Relative positioning
        case 'G91':
          this.axesRelative = true
          this.extrusionRelative = true
          break
          // Absolute extrusion
        case 'M82':
          this.extrusionRelative = false
          break
          // Relative extrusion
        case 'M83':
          this.extrusionRelative = true
          break
          // Set position without moving
        case 'G92':
          this.machineState = {
            ...this.machineState,
            x: args.x ?? this.machineState.x,
            y: args.y ?? this.machineState.y,
            z: args.z ?? this.machineState.z,
            e: args.e ?? this.machineState.e
          }
          break
      }
    }
  }

  extrusionDelta (args, move) {
    // E increment brought by a single command, whatever the E mode
    if (args.e === undefined) return 0
    return this.extrusionRelative ? args.e : move.e - this.machineState.e
  }

  newLayer (move) {
    this.currentLayer = { vertices: [], z: move.z, colors: [], filePositions: [], durations: [] }
    this.layers.push(this.currentLayer)
  }

  addTravel (start, end) {
    // Time spent moving between segments, charged to the gap before the next one
    const length = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z)
    this.pendingTravelSeconds += (length || 0) / feedrateMmPerSecond(end.f)
  }

  addSegment (start, end) {
    // Check coordinates
    if (Number.isNaN(start.x) || Number.isNaN(start.y) || Number.isNaN(start.z) || Number.isNaN(end.x) || Number.isNaN(end.y) || Number.isNaN(end.z)) {
      console.warn('PrettyGCode: bad line segment', start, end)
      return
    }

    // Open a layer if none is active yet
    if (this.currentLayer == null) this.newLayer(start)
    const layer = this.currentLayer

    // Store the segment endpoints and its position in the file
    layer.vertices.push(start.x, start.y, start.z, end.x, end.y, end.z)
    layer.filePositions.push(this.filePosition)

    // Estimated seconds of the travel leading here and of the segment itself
    const length = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z) || Math.abs(end.e - start.e) || 0
    layer.durations.push(this.pendingTravelSeconds, length / feedrateMmPerSecond(end.f))
    this.pendingTravelSeconds = 0

    // Grow the model bounds only after a slicer color is set, so pre-print moves don't skew the framing
    if (this.currentColor !== DEFAULT_COLOR) {
      this.bounds.expandByPoint(start)
      this.bounds.expandByPoint(end)
    }

    // Fake shading: tint by the segment's angle, alternating per layer for readability
    const direction = scratchDirection.set(end.x - start.x, end.y - start.y, end.z - start.z).normalize()
    const angleShade = ((direction.x / 2) + 0.5) / 5.0
    const drawColor = scratchColor.copy(this.currentColor)
    drawColor.getHSL(scratchHsl)
    scratchHsl.l = angleShade + (this.layers.length % 2 === 0 ? 0.25 : 0.30)
    drawColor.setHSL(scratchHsl.h, scratchHsl.s, scratchHsl.l)

    // Same color on both endpoints of the segment
    layer.colors.push(drawColor.r, drawColor.g, drawColor.b, drawColor.r, drawColor.g, drawColor.b)
  }
}

// Download and parse a job's gcode; an empty path yields an empty result
export async function parseGcodeFile (jobPath) {
  const parser = new GCodeParser()
  if (!jobPath) return parser

  const fileUrl = OctoPrint.files.downloadPath('local', jobPath)
  const response = await fetch(fileUrl)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    parser.parse(decoder.decode(value, { stream: true }))
  }

  return parser
}
