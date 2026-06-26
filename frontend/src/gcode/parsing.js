import * as THREE from '../three.js'
import { interpolateArc } from './arc-interpolation.js'

// Initial state
const INITIAL_STATE = Object.freeze({ x: 0, y: 0, z: 0, e: 0, f: 0 })

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

// Layer names
const LAYER_PREFIX = 'layer#'
const isLayerObject = (child) => child.name.startsWith(LAYER_PREFIX)

// Lines thickness based on nozzle size
const NOZZLE_DIAMETER_COMMENT = /nozzle[_ ]?diameter\s*[:=]\s*([\d.]+)/i // E.g. "; nozzle_diameter = 0.4"
const DEFAULT_NOZZLE_DIAMETER = 0.4
const LINE_THICKNESS_FACTOR = 1.1 // A slightly oversize to avoid gaps

// Material makers
const makeThinMaterial = (clippingPlanes = null) => new THREE.LineBasicMaterial({ vertexColors: true, clippingPlanes })
const makeThickMaterial = (clippingPlanes = null) =>
  new THREE.LineMaterial({ worldUnits: true, linewidth: DEFAULT_NOZZLE_DIAMETER * LINE_THICKNESS_FACTOR, vertexColors: true, clippingPlanes })
const makeHighlightMaterial = () => {
  const highlightMaterial = makeThickMaterial()
  highlightMaterial.color.setRGB(0.5, 0.5, 0.5)
  return highlightMaterial
}

// Reused across addSegment to avoid per-segment allocations
const scratchDirection = new THREE.Vector3()
const scratchColor = new THREE.Color()
const scratchHsl = {}

export class GCodeParser {
  // Group holding the gcode lines
  gcodeGroup = new THREE.Group()

  // Bounding box of the extruded gcode
  bounds = new THREE.Box3()

  // Parsing states
  state = INITIAL_STATE
  layers = []
  currentLayer = null
  currentColor = DEFAULT_COLOR
  pendingLine = ''
  filePos = 0
  relative = false
  gcodeNozzleDiameter = null

  // Line materials for the gcode
  thinMaterial = makeThinMaterial()
  thickMaterial = makeThickMaterial()
  highlightMaterial = makeHighlightMaterial()

  /* ---- Setup ---- */

  constructor (app) {
    this.app = app

    // Mirror materials, clipped to the bed
    const mirrorBoundsPlanes = this.app.viewer.mirrorBoundsPlanes
    this.mirrorThickMaterial = makeThickMaterial(mirrorBoundsPlanes)
    this.mirrorThinMaterial = makeThinMaterial(mirrorBoundsPlanes)
  }

  reset () {
    this.state = INITIAL_STATE
    this.layers = []
    this.currentLayer = null
    this.currentColor = DEFAULT_COLOR
    this.pendingLine = ''
    this.filePos = 0
    this.relative = false
    this.gcodeNozzleDiameter = null
    this.gcodeGroup.clear()
    this.bounds.makeEmpty()
  }

  getObject () {
    return this.gcodeGroup
  }

  /* ---- Gcode Loading ---- */

  async loadGcode (jobPath) {
    // Reset parser
    this.reset()

    // If no job has been selected, report 0 loaded layers to app
    if (!jobPath) {
      this.app.onGcodeLoaded(0)
      return
    }

    // Download and decode the file
    const fileUrl = OctoPrint.files.downloadPath('local', jobPath)
    const response = await fetch(fileUrl)
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      this.parse(decoder.decode(value, { stream: true }))
    }

    // Flush the last open layer
    if (this.currentLayer != null) this.addObject(this.currentLayer)

    // Size the lines
    this.applyLineWidth()

    // Report layers count to app
    this.app.onGcodeLoaded(this.layers.length)
  }

  /* ---- Gcode Parsing ---- */

  parse (chunk) {
    // Chunks may split a line in two: prepend last call's leftover, hold the new trailing partial for next time
    const lines = chunk.split('\n')
    lines[0] = this.pendingLine + lines[0]
    this.pendingLine = lines[lines.length - 1]

    for (let i = 0; i < lines.length - 1; i++) {
      // Get the line
      const rawLine = lines[i]
      this.filePos += rawLine.length + 1

      if (rawLine.includes(';')) {
        const commentLower = rawLine.toLowerCase()

        // Pick the color based on the feature type
        const match = COLOR_KEYWORDS.find(([keyword]) => commentLower.includes(keyword))
        if (match) this.currentColor = new THREE.Color(match[1])

        // First nozzle diameter the slicer states wins
        if (this.gcodeNozzleDiameter == null) {
          const nozzleMatch = commentLower.match(NOZZLE_DIAMETER_COMMENT)
          if (nozzleMatch) this.gcodeNozzleDiameter = parseFloat(nozzleMatch[1])
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
      const coord = (key) => args[key] !== undefined ? this.absolute(this.state[key], args[key]) : this.state[key]

      switch (cmd) {
        // Linear move
        case 'G0':
        case 'G1': {
          const move = { x: coord('x'), y: coord('y'), z: coord('z'), e: coord('e'), f: coord('f') }

          // New layer when extrusion resumes at a new Z, not just on any Z move
          if (this.delta(this.state.e, move.e) > 0 && (this.currentLayer == null || move.z !== this.currentLayer.z)) {
            this.newLayer(move)
          }

          // Extrude a segment when E is present
          if (args.e !== undefined) this.addSegment(this.state, move)
          this.state = move
          break
        }
        // Arc move (G2 clockwise, G3 counter-clockwise)
        case 'G2':
        case 'G3': {
          if (args.k !== undefined) {
            console.warn('PrettyGCode: Arcs with K parameter not currently supported')
            break
          }
          if (args.r !== undefined) {
            console.warn('PrettyGCode: Arc in R form are not currently supported')
            break
          }

          const arc = {
            x: coord('x'),
            y: coord('y'),
            z: coord('z'),
            i: args.i ?? 0, // X offset from start to arc center
            j: args.j ?? 0, // Y offset from start to arc center
            e: coord('e'), // extruder position
            f: coord('f'), // feedrate
            is_clockwise: cmd === 'G2'
          }

          // New layer when extrusion resumes at a new Z, not just on any Z move
          if (this.delta(this.state.e, arc.e) > 0 && (this.currentLayer == null || arc.z !== this.currentLayer.z)) {
            this.newLayer(arc)
          }

          // Split the arc into straight segments
          const segments = interpolateArc(this.state, arc)
          if (args.e !== undefined) {
            for (let segmentIndex = 1; segmentIndex < segments.length; segmentIndex++) {
              this.addSegment(segments[segmentIndex - 1], segments[segmentIndex])
            }
          }
          this.state = segments[segments.length - 1]
          break
        }
        // Absolute positioning
        case 'G90':
          this.relative = false
          break
          // Relative positioning
        case 'G91':
          this.relative = true
          break
          // Set position without moving
        case 'G92':
          this.state = {
            ...this.state,
            x: args.x ?? this.state.x,
            y: args.y ?? this.state.y,
            z: args.z ?? this.state.z,
            e: args.e ?? this.state.e
          }
          break
      }
    }
  }

  delta (previous, value) {
    return this.relative ? value : value - previous
  }

  absolute (base, value) {
    return this.relative ? base + value : value
  }

  newLayer (line) {
    if (this.currentLayer != null) this.addObject(this.currentLayer)
    this.currentLayer = { vertex: [], z: line.z, colors: [], filePositions: [] }
    this.layers.push(this.currentLayer)
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
    layer.vertex.push(start.x, start.y, start.z, end.x, end.y, end.z)
    layer.filePositions.push(this.filePos)

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

  /* ---- Object building ---- */

  makeLine (vertex, colors, material) {
    if (this.app.settings.thickLines) {
      // Thick lines
      const geometry = new THREE.LineSegmentsGeometry()
      geometry.setPositions(vertex)
      geometry.setColors(colors)
      return new THREE.LineSegments2(geometry, material)
    } else {
      // Thin lines
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertex, 3))
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
      return new THREE.LineSegments(geometry, material)
    }
  }

  addObject (layer, layerNumber = this.layers.length) {
    // Skip empty layers
    if (layer.vertex.length <= 2) return

    const thickLines = this.app.settings.thickLines

    // Per-layer metadata
    const userData = {
      layerZ: layer.z,
      layerNumber,
      numLines: layer.vertex.length / 6,
      filePositions: layer.filePositions
    }

    // Build the layer's line object and add it to the gcode group
    const line = this.makeLine(layer.vertex, layer.colors, thickLines ? this.thickMaterial : this.thinMaterial)
    line.name = LAYER_PREFIX + layerNumber
    line.userData = userData
    this.gcodeGroup.add(line)

    // Build and add the layer's line object to the mirror
    if (this.app.settings.showMirror) {
      const { vertex, colors } = this.makeMirrorData(layer)
      const mirror = this.makeLine(vertex, colors, thickLines ? this.mirrorThickMaterial : this.mirrorThinMaterial)
      mirror.name = LAYER_PREFIX + layerNumber
      mirror.userData = { ...userData, mirror: true }
      this.gcodeGroup.add(mirror)
    }
  }

  makeMirrorData (layer) {
    // Mirror through the bed: flip the Z of every vertex
    const vertex = layer.vertex.slice()
    for (let i = 2; i < vertex.length; i += 3) vertex[i] = -vertex[i]

    // Halve each color's lightness so the reflection reads as dimmer
    const colors = layer.colors.slice()
    const color = new THREE.Color()
    const hsl = {}
    for (let i = 0; i < colors.length; i += 3) {
      color.setRGB(colors[i], colors[i + 1], colors[i + 2])
      color.getHSL(hsl)
      color.setHSL(hsl.h, hsl.s, hsl.l / 2)
      colors[i] = color.r
      colors[i + 1] = color.g
      colors[i + 2] = color.b
    }

    return { vertex, colors }
  }

  rebuildObject () {
    // Rebuild the 3D object from already-parsed data
    // This is needed e.g. when settings/materials change
    this.gcodeGroup.clear()
    this.layers.forEach((layer, i) => this.addObject(layer, i + 1))
    this.app.viewer.requestRender()
  }

  applyLineWidth () {
    // The slicer's nozzle diameter wins over the printer profile
    const nozzleDiameter = this.gcodeNozzleDiameter ?? this.app.nozzleDiameter ?? DEFAULT_NOZZLE_DIAMETER
    const lineWidth = nozzleDiameter * LINE_THICKNESS_FACTOR

    this.thickMaterial.linewidth = lineWidth
    this.mirrorThickMaterial.linewidth = lineWidth
    this.highlightMaterial.linewidth = lineWidth

    this.app.viewer.requestRender()
  }

  /* ---- Viewer sync ---- */

  highlightLayer (layerNumber) {
    // Highlight material works only on thick lines
    if (!this.app.settings.thickLines) return

    // Material for every layer except the highlighted one
    const defaultMaterial = this.app.settings.thickLines ? this.thickMaterial : this.thinMaterial

    this.gcodeGroup.traverse((child) => {
      if (!isLayerObject(child)) return

      // The mirror keeps its own bed-clipped material
      if (child.userData.mirror) return

      // Highlight the target layer, default on the others
      child.material = child.userData.layerNumber === layerNumber ? this.highlightMaterial : defaultMaterial
    })
  }

  syncGcodeObjToLayer (layerNumber) {
    let needUpdate = false

    this.gcodeGroup.traverse((child) => {
      if (!isLayerObject(child)) return

      // Layers above the current one are hidden
      if (child.userData.layerNumber > layerNumber) {
        if (child.visible) needUpdate = true
        child.visible = false
        return
      }

      // The rest are shown whole
      const count = child.userData.numLines
      if (!child.visible || child.geometry.instanceCount !== count) needUpdate = true
      child.visible = true
      child.geometry.instanceCount = count
    })

    return needUpdate
  }

  syncGcodeObjToFilePos (filePosition) {
    let currentLayerNumber = 0

    this.gcodeGroup.traverse((child) => {
      if (!isLayerObject(child)) return

      // File-position range this layer covers
      const filePositions = child.userData.filePositions
      const filePositionMin = filePositions[0]
      const filePositionMax = filePositions[filePositions.length - 1]

      if (filePositionMax < filePosition) {
        // Already fully printed: show the whole layer
        child.visible = true
        child.geometry.instanceCount = child.userData.numLines
      } else if (filePositionMin > filePosition) {
        // Not started yet: hide it
        child.visible = false
      } else {
        // In progress: show up to the playhead and mark this as the current layer
        child.visible = true
        let count = 0
        while (count < filePositions.length && filePositions[count] < filePosition) count++
        child.geometry.instanceCount = Math.min(count, child.userData.numLines)
        currentLayerNumber = child.userData.layerNumber
      }
    })

    return currentLayerNumber
  }
}
