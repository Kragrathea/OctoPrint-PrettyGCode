import * as THREE from '../three.js'
import { arcOffsetFromRadius, interpolateArc } from './arc-interpolation.js'

/* ---- Gcode parsing ---- */

// Initial state
const INITIAL_STATE = Object.freeze({ x: 0, y: 0, z: 0, e: 0, f: 0 })

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

/* ---- Object building ---- */

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

/* ---- Viewer sync ---- */

// How far behind the live print the shown nozzle trails to absorb bursty updates.
// Higher looks smoother but lags real time more, lower tracks tighter but can stutter.
const NOZZLE_LAG_SECONDS = 1.5
// A read position leaping farther ahead than this (a seek, a mid-print reload) snaps instead of sweeping the whole way
const NOZZLE_SNAP_SECONDS = 120

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
  pendingTravelSeconds = 0
  axesRelative = false
  extrusionRelative = false
  gcodeNozzleDiameter = null

  // Drawn segments indexed for lookup across layers
  drawnLayers = []
  totalSegments = 0

  // Cumulative estimated time (s) at each drawn segment's start/end, travel gaps included
  segmentStartTimes = null
  segmentEndTimes = null

  // The nozzle eased along the estimated timeline: where it is and where the read position points
  nozzleTime = 0
  targetTime = 0
  nozzlePosition = new THREE.Vector3()

  // The growing tip drawn along the segment the nozzle is currently laying down
  tipLine = null

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
    this.pendingTravelSeconds = 0
    this.axesRelative = false
    this.extrusionRelative = false
    this.gcodeNozzleDiameter = null
    this.drawnLayers = []
    this.totalSegments = 0
    this.segmentStartTimes = null
    this.segmentEndTimes = null
    this.nozzleTime = 0
    this.targetTime = 0
    this.tipLine = null
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

    // Index layers
    this.indexLayers()

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
      this.filePos += (NON_ASCII.test(rawLine) ? textEncoder.encode(rawLine).length : rawLine.length) + 1

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
      const coord = (key) => {
        if (args[key] === undefined) return this.state[key]
        if (key === 'f') return args.f
        const relative = key === 'e' ? this.extrusionRelative : this.axesRelative
        return relative ? this.state[key] + args[key] : args[key]
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
          if (args.e !== undefined) this.addSegment(this.state, move)
          else this.addTravel(this.state, move)
          this.state = move
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
            ? arcOffsetFromRadius(this.state, move, args.r, cmd === 'G2')
            : { i: args.i ?? 0, j: args.j ?? 0 }

          // Arcs with K, or an R that gives no usable center, fall back to a straight segment
          // so the next moves still start from the right point
          if (args.k !== undefined || (args.r !== undefined && !offset.i && !offset.j)) {
            console.warn('PrettyGCode: Unsupported arc', rawLine)
            if (args.e !== undefined) this.addSegment(this.state, move)
            else this.addTravel(this.state, move)
            this.state = move
            break
          }

          // Split the arc into straight segments
          const arc = {
            ...move,
            i: offset.i, // X offset from start to arc center
            j: offset.j, // Y offset from start to arc center
            is_clockwise: cmd === 'G2'
          }
          const segments = interpolateArc(this.state, arc)
          for (let segmentIndex = 1; segmentIndex < segments.length; segmentIndex++) {
            if (args.e !== undefined) this.addSegment(segments[segmentIndex - 1], segments[segmentIndex])
            else this.addTravel(segments[segmentIndex - 1], segments[segmentIndex])
          }
          this.state = segments[segments.length - 1]
          break
        }
        // Dwell: the pause adds to the time of the travel toward the next segment
        case 'G4':
          this.pendingTravelSeconds += (args.s || 0) + (args.p || 0) / 1000
          break
        // Home: the named axes (all of them if none is given) end up at the origin
        case 'G28': {
          const all = args.x === undefined && args.y === undefined && args.z === undefined
          this.state = {
            ...this.state,
            x: all || args.x !== undefined ? 0 : this.state.x,
            y: all || args.y !== undefined ? 0 : this.state.y,
            z: all || args.z !== undefined ? 0 : this.state.z
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

  extrusionDelta (args, move) {
    // E increment brought by a single command, whatever the E mode
    if (args.e === undefined) return 0
    return this.extrusionRelative ? args.e : move.e - this.state.e
  }

  newLayer (line) {
    if (this.currentLayer != null) this.addObject(this.currentLayer)
    this.currentLayer = { vertex: [], z: line.z, colors: [], filePositions: [], durations: [] }
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
    layer.vertex.push(start.x, start.y, start.z, end.x, end.y, end.z)
    layer.filePositions.push(this.filePos)

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
    this.indexLayers()
    this.app.viewer.requestRender()
  }

  indexLayers () {
    // Flatten the drawn layers into print order, tracking each one's running segment offset
    this.drawnLayers = []
    let base = 0
    this.layers.forEach((layer, i) => {
      if (layer.vertex.length <= 2) return // empty layers have no drawn object
      const numLines = layer.vertex.length / 6
      this.drawnLayers.push({ layerNumber: i + 1, globalBase: base, numLines, vertex: layer.vertex, colors: layer.colors, filePositions: layer.filePositions, durations: layer.durations })
      base += numLines
    })
    this.totalSegments = base

    // Timeline coordinate of every segment, counting the travel gaps between them, so the
    // nozzle can be eased along the whole path at each move's own pace
    const starts = new Float64Array(this.totalSegments)
    const ends = new Float64Array(this.totalSegments)
    let time = 0
    let globalIndex = 0
    for (const layer of this.drawnLayers) {
      const durations = layer.durations
      for (let offset = 0; offset < durations.length; offset += 2) {
        time += durations[offset]
        starts[globalIndex] = time
        time += durations[offset + 1]
        ends[globalIndex] = time
        globalIndex++
      }
    }
    this.segmentStartTimes = starts
    this.segmentEndTimes = ends

    // Stamp each layer's segment offset onto its render objects, so the reveal reads it per child
    const baseByLayer = new Map(this.drawnLayers.map((entry) => [entry.layerNumber, entry.globalBase]))
    this.gcodeGroup.traverse((child) => {
      if (isLayerObject(child)) child.userData.globalBase = baseByLayer.get(child.userData.layerNumber)
    })

    this.buildTipLine()
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

    // Hide the growing tip while a layer is manually browsed
    if (this.tipLine && this.tipLine.visible) {
      this.tipLine.visible = false
      needUpdate = true
    }

    this.gcodeGroup.traverse((child) => {
      if (!isLayerObject(child)) return

      // Layers above the current one are hidden
      if (child.userData.layerNumber > layerNumber) {
        if (child.visible) needUpdate = true
        child.visible = false
        return
      }

      // The rest are shown whole
      if (!child.visible) needUpdate = true
      child.visible = true
      if (this.setRevealCount(child, child.userData.numLines)) needUpdate = true
    })

    return needUpdate
  }

  syncGcodeObjToNozzle (filePosition, deltaSeconds) {
    if (!this.drawnLayers.length) return 0

    // How much of the print has been sent to the printer so far
    const segmentsRead = this.segmentsReadAt(filePosition)
    this.targetTime = segmentsRead < this.totalSegments
      ? this.segmentStartTimes[segmentsRead]
      : this.segmentEndTimes[this.totalSegments - 1]

    // Follow that point smoothly: the nozzle stops when nothing new arrives and speeds up
    // after a burst of commands; it jumps only when the point is behind it or very far ahead
    const backlog = this.targetTime - this.nozzleTime
    if (backlog < 0 || backlog > NOZZLE_SNAP_SECONDS) this.nozzleTime = this.targetTime
    else this.nozzleTime += backlog * (1 - Math.exp(-deltaSeconds / NOZZLE_LAG_SECONDS))

    // Where along the timeline the nozzle sits: reveal, tip and nozzle model all derive from here
    const spot = this.locateTime(this.nozzleTime)
    const revealed = spot.index

    // Fully show layers the reveal has passed, a prefix of the one it's inside, hide those it hasn't reached
    this.gcodeGroup.traverse((child) => {
      if (!isLayerObject(child)) return
      const base = child.userData.globalBase
      const numLines = child.userData.numLines
      if (revealed >= base + numLines) {
        child.visible = true
        this.setRevealCount(child, numLines)
      } else if (revealed <= base) {
        child.visible = false
      } else {
        child.visible = true
        this.setRevealCount(child, revealed - base)
      }
    })

    // Grow the segment the nozzle is mid-way through and place the nozzle model
    this.updateTipLine(spot)
    this.updateNozzlePosition(spot)

    // Return layer holding the last revealed segment
    let currentLayerNumber = 0
    for (const layer of this.drawnLayers) {
      if (revealed <= layer.globalBase) break
      currentLayerNumber = layer.layerNumber
    }
    return currentLayerNumber
  }

  segmentsReadAt (filePosition) {
    // How many drawn segments the read position has reached
    let count = 0

    for (const layer of this.drawnLayers) {
      const filePositions = layer.filePositions
      if (filePositions[0] > filePosition) break
      if (filePositions[filePositions.length - 1] < filePosition) {
        count = layer.globalBase + layer.numLines
      } else {
        // Segments in this layer already read (binary search over the sorted file positions)
        let lo = 0; let hi = filePositions.length
        while (lo < hi) {
          const mid = (lo + hi) >> 1
          if (filePositions[mid] < filePosition) lo = mid + 1
          else hi = mid
        }
        count = layer.globalBase + lo
        break
      }
    }

    return count
  }

  locateTime (time) {
    // Segment (or the travel gap before it) holding a timeline coordinate, and the fraction into it
    const starts = this.segmentStartTimes
    const ends = this.segmentEndTimes

    // First segment whose end lies past the coordinate (binary search)
    let lo = 0; let hi = ends.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (ends[mid] <= time) lo = mid + 1
      else hi = mid
    }
    if (lo >= ends.length) return { index: ends.length, fraction: 1, onSegment: false }

    if (time >= starts[lo]) {
      const duration = ends[lo] - starts[lo]
      return { index: lo, fraction: duration > 0 ? (time - starts[lo]) / duration : 1, onSegment: true }
    }
    const gapStart = lo > 0 ? ends[lo - 1] : 0
    const gap = starts[lo] - gapStart
    return { index: lo, fraction: gap > 0 ? (time - gapStart) / gap : 0, onSegment: false }
  }

  updateNozzlePosition (spot) {
    const position = this.nozzlePosition

    // Past the end: park on the last segment's endpoint
    if (spot.index >= this.totalSegments) {
      const last = this.segmentAt(this.totalSegments - 1)
      position.fromArray(last.layer.vertex, last.local * 6 + 3)
      return
    }

    const segment = this.segmentAt(spot.index)
    const vertex = segment.layer.vertex
    const offset = segment.local * 6

    if (spot.onSegment) {
      // Along the segment being drawn
      position.set(
        vertex[offset] + (vertex[offset + 3] - vertex[offset]) * spot.fraction,
        vertex[offset + 1] + (vertex[offset + 4] - vertex[offset + 1]) * spot.fraction,
        vertex[offset + 2] + (vertex[offset + 5] - vertex[offset + 2]) * spot.fraction
      )
    } else if (spot.index > 0) {
      // In a travel gap: glide from the previous segment's end to this one's start
      const previous = this.segmentAt(spot.index - 1)
      const from = previous.layer.vertex
      const fromOffset = previous.local * 6
      position.set(
        from[fromOffset + 3] + (vertex[offset] - from[fromOffset + 3]) * spot.fraction,
        from[fromOffset + 4] + (vertex[offset + 1] - from[fromOffset + 4]) * spot.fraction,
        from[fromOffset + 5] + (vertex[offset + 2] - from[fromOffset + 5]) * spot.fraction
      )
    } else {
      // Wait at the start of the segment
      position.fromArray(vertex, offset)
    }
  }

  getNozzlePosition () {
    // Not meaningful until the print reaches the first segment (e.g. homing, heating)
    return this.targetTime > 0 ? this.nozzlePosition : null
  }

  setRevealCount (child, count) {
    // Thick lines are instanced; thin ones aren't, so limit their drawn vertex range (2 per segment)
    const geometry = child.geometry
    if (this.app.settings.thickLines) {
      if (geometry.instanceCount === count) return false
      geometry.instanceCount = count
    } else {
      if (geometry.drawRange.count === count * 2) return false
      geometry.setDrawRange(0, count * 2)
    }
    return true
  }

  /* ---- Growing tip line ---- */

  buildTipLine () {
    if (this.tipLine) {
      this.gcodeGroup.remove(this.tipLine)
      this.tipLine.geometry.dispose()
    }

    const positions = new Float32Array(6)
    const colors = new Float32Array(6)
    let line
    if (this.app.settings.thickLines) {
      const geometry = new THREE.LineSegmentsGeometry()
      geometry.setPositions(positions)
      geometry.setColors(colors)
      line = new THREE.LineSegments2(geometry, this.highlightMaterial)
    } else {
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
      line = new THREE.LineSegments(geometry, this.thinMaterial)
    }

    line.visible = false
    line.frustumCulled = false

    this.tipLine = line
    this.gcodeGroup.add(line)
  }

  updateTipLine (spot) {
    const tipLine = this.tipLine
    if (!tipLine) return

    // Nothing grows while traveling between segments or past the end
    if (!spot.onSegment || spot.fraction <= 0) {
      tipLine.visible = false
      return
    }

    const segment = this.segmentAt(spot.index)
    const vertex = segment.layer.vertex
    const offset = segment.local * 6
    const startX = vertex[offset]; const startY = vertex[offset + 1]; const startZ = vertex[offset + 2]

    // Grow up to how far along the segment the nozzle has reached
    const progress = spot.fraction
    const colors = segment.layer.colors
    this.setTipLineGeometry(startX, startY, startZ,
      startX + (vertex[offset + 3] - startX) * progress, startY + (vertex[offset + 4] - startY) * progress, startZ + (vertex[offset + 5] - startZ) * progress,
      colors[offset], colors[offset + 1], colors[offset + 2])
    tipLine.visible = true
  }

  setTipLineGeometry (startX, startY, startZ, endX, endY, endZ, r, g, b) {
    const geometry = this.tipLine.geometry
    if (this.app.settings.thickLines) {
      const positions = geometry.attributes.instanceStart.data
      positions.array.set([startX, startY, startZ, endX, endY, endZ])
      positions.needsUpdate = true
      const colors = geometry.attributes.instanceColorStart.data
      colors.array.set([r, g, b, r, g, b])
      colors.needsUpdate = true
    } else {
      geometry.attributes.position.array.set([startX, startY, startZ, endX, endY, endZ])
      geometry.attributes.position.needsUpdate = true
      geometry.attributes.color.array.set([r, g, b, r, g, b])
      geometry.attributes.color.needsUpdate = true
    }
  }

  segmentAt (globalIndex) {
    for (const layer of this.drawnLayers) {
      if (globalIndex < layer.globalBase + layer.numLines) return { layer, local: globalIndex - layer.globalBase }
    }
    return null
  }
}
