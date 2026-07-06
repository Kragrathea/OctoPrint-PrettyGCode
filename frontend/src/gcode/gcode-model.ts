import * as THREE from '../three-exports'
import type { Settings } from '../settings'
import type { Layer } from './parser'
import type { PrintTimeline, TimelineSpot } from './print-timeline'

/** A layer's rendered line object */
type LayerLine = THREE.LineSegments2 | THREE.LineSegments

/** Name prefix of the layer line objects */
const LAYER_PREFIX = 'layer#'

/**
 * Tells whether a scene object is one of the rendered gcode layers
 * @param child - Scene object to test
 * @returns True for layer line objects
 */
const isLayerObject = (child: THREE.Object3D): child is LayerLine => child.name.startsWith(LAYER_PREFIX)

/** Nozzle diameter in mm assumed when none is known */
const DEFAULT_NOZZLE_DIAMETER = 0.4
/** Oversize factor of the drawn lines, to avoid gaps */
const LINE_THICKNESS_FACTOR = 1.1

/**
 * Makes the material for thin gcode lines
 * @param clippingPlanes - Clipping planes to apply, if any
 * @returns The new material
 */
const makeThinMaterial = (clippingPlanes: THREE.Plane[] | null = null) => new THREE.LineBasicMaterial({ vertexColors: true, clippingPlanes })

/**
 * Makes the material for thick gcode lines
 * @param clippingPlanes - Clipping planes to apply, if any
 * @returns The new material
 */
const makeThickMaterial = (clippingPlanes: THREE.Plane[] | null = null) =>
  new THREE.LineMaterial({ worldUnits: true, linewidth: DEFAULT_NOZZLE_DIAMETER * LINE_THICKNESS_FACTOR, vertexColors: true, clippingPlanes })

/**
 * Makes the material for the highlighted layer
 * @returns The new material
 */
const makeHighlightMaterial = () => {
  const highlightMaterial = makeThickMaterial()
  highlightMaterial.color.setRGB(0.5, 0.5, 0.5)
  return highlightMaterial
}

/** The rendered gcode model, made of per-layer line objects */
export class GCodeModel {
  /** Group holding the gcode model lines */
  linesGroup = new THREE.Group()

  /** Layers the model was last built from */
  layers: Layer[] = []

  /** The growing tip drawn along the segment the nozzle is currently laying down */
  tipLine: LayerLine | null = null

  /** Material for thin lines */
  thinMaterial = makeThinMaterial()
  /** Material for thick lines */
  thickMaterial = makeThickMaterial()
  /** Material for the highlighted layer */
  highlightMaterial = makeHighlightMaterial()

  /** Thick line material for the mirror, clipped to the bed */
  mirrorThickMaterial: THREE.LineMaterial
  /** Thin line material for the mirror, clipped to the bed */
  mirrorThinMaterial: THREE.LineBasicMaterial

  /** Plugin frontend settings */
  settings: Settings

  /** Print timeline of the loaded gcode */
  timeline: PrintTimeline

  /**
   * @param settings - Plugin frontend settings
   * @param timeline - Print timeline of the loaded gcode
   * @param mirrorBoundsPlanes - Planes clipping the mirror to the bed
   */
  constructor (settings: Settings, timeline: PrintTimeline, mirrorBoundsPlanes: THREE.Plane[]) {
    this.settings = settings
    this.timeline = timeline

    this.mirrorThickMaterial = makeThickMaterial(mirrorBoundsPlanes)
    this.mirrorThinMaterial = makeThinMaterial(mirrorBoundsPlanes)
  }

  /* ---- Object building ---- */

  /**
   * Builds the model's line objects from parsed layers
   * @param layers - Parsed gcode layers
   */
  build (layers: Layer[]) {
    this.layers = layers
    this.linesGroup.clear()
    layers.forEach((layer, i) => this.addLayerLines(layer, i + 1))

    // Stamp each layer's segment offset onto its render objects, so the reveal reads it per child
    const baseByLayer = new Map(this.timeline.drawnLayers.map((entry) => [entry.layerNumber, entry.globalBase]))
    this.linesGroup.traverse((child) => {
      if (isLayerObject(child)) child.userData.globalBase = baseByLayer.get(child.userData.layerNumber)
    })

    this.buildTipLine()
  }

  /** Rebuilds the model from the last given layers, e.g. after a settings change */
  rebuild () {
    this.build(this.layers)
  }

  /**
   * Creates a line object
   * @param vertices - Segment endpoints as flat XYZ triplets
   * @param colors - Vertex colors as flat RGB triplets
   * @param material - Material to render with
   * @returns The new line object
   */
  makeLine (vertices: number[], colors: number[], material: THREE.LineMaterial | THREE.LineBasicMaterial): LayerLine {
    if (this.settings.thickLines) {
      // Thick lines
      const geometry = new THREE.LineSegmentsGeometry()
      geometry.setPositions(vertices)
      geometry.setColors(colors)
      return new THREE.LineSegments2(geometry, material as THREE.LineMaterial)
    } else {
      // Thin lines
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
      return new THREE.LineSegments(geometry, material)
    }
  }

  /**
   * Adds a layer's lines to the model
   * @param layer - Parsed layer
   * @param layerNumber - 1-based layer number
   */
  addLayerLines (layer: Layer, layerNumber: number) {
    // Skip empty layers
    if (layer.vertices.length <= 2) return

    const thickLines = this.settings.thickLines

    // Per-layer metadata
    const userData = {
      layerZ: layer.z,
      layerNumber,
      numSegments: layer.vertices.length / 6,
      filePositions: layer.filePositions
    }

    // Build the layer's line object and add it to the gcode group
    const line = this.makeLine(layer.vertices, layer.colors, thickLines ? this.thickMaterial : this.thinMaterial)
    line.name = LAYER_PREFIX + layerNumber
    line.userData = userData
    this.linesGroup.add(line)

    // Build and add the layer's line object to the mirror
    if (this.settings.showMirror) {
      const { vertices, colors } = this.makeMirrorData(layer)
      const mirror = this.makeLine(vertices, colors, thickLines ? this.mirrorThickMaterial : this.mirrorThinMaterial)
      mirror.name = LAYER_PREFIX + layerNumber
      mirror.userData = { ...userData, mirror: true }
      this.linesGroup.add(mirror)
    }
  }

  /**
   * Derives a layer's geometry mirrored through the bed
   * @param layer - Parsed layer
   * @returns The mirror's vertices and colors
   */
  makeMirrorData (layer: Layer) {
    // Mirror through the bed: flip the Z of every vertex
    const vertices = layer.vertices.slice()
    for (let i = 2; i < vertices.length; i += 3) vertices[i] = -vertices[i]

    // Halve each color's lightness so the reflection reads as dimmer
    const colors = layer.colors.slice()
    const color = new THREE.Color()
    const hsl = { h: 0, s: 0, l: 0 }
    for (let i = 0; i < colors.length; i += 3) {
      color.setRGB(colors[i], colors[i + 1], colors[i + 2])
      color.getHSL(hsl)
      color.setHSL(hsl.h, hsl.s, hsl.l / 2)
      colors[i] = color.r
      colors[i + 1] = color.g
      colors[i + 2] = color.b
    }

    return { vertices, colors }
  }

  /**
   * Sets the drawn line thickness from the nozzle size
   * @param nozzleDiameter - Nozzle diameter in mm, or null for the default
   */
  applyLineWidth (nozzleDiameter: number | null) {
    const lineWidth = (nozzleDiameter ?? DEFAULT_NOZZLE_DIAMETER) * LINE_THICKNESS_FACTOR

    this.thickMaterial.linewidth = lineWidth
    this.mirrorThickMaterial.linewidth = lineWidth
    this.highlightMaterial.linewidth = lineWidth
  }

  /* ---- Reveal and highlight ---- */

  /**
   * Highlights a layer, unhighlighting the others
   * @param layerNumber - 1-based layer number to highlight
   */
  highlightLayer (layerNumber: number) {
    // Highlight material works only on thick lines
    if (!this.settings.thickLines) return

    this.linesGroup.traverse((child) => {
      if (!isLayerObject(child)) return

      // The mirror keeps its own bed-clipped material
      if (child.userData.mirror) return

      // Highlight the target layer, default on the others
      child.material = this.settings.highlightLayer && child.userData.layerNumber === layerNumber ? this.highlightMaterial : this.thickMaterial
    })
  }

  /**
   * Shows the layers up to the given one, hiding the ones above
   * @param layerNumber - 1-based topmost layer to show
   * @returns True if anything changed
   */
  syncToLayer (layerNumber: number) {
    let needUpdate = false

    // Hide the growing tip while a layer is manually browsed
    if (this.tipLine && this.tipLine.visible) {
      this.tipLine.visible = false
      needUpdate = true
    }

    this.linesGroup.traverse((child) => {
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
      if (this.setRevealCount(child, child.userData.numSegments)) needUpdate = true
    })

    return needUpdate
  }

  /**
   * Reveals the model up to a print timeline position
   * @param spot - Timeline position to reveal up to
   */
  revealTo (spot: TimelineSpot) {
    const revealed = spot.segmentIndex

    // Fully show layers the reveal has passed, a prefix of the one it's inside, hide those it hasn't reached
    this.linesGroup.traverse((child) => {
      if (!isLayerObject(child)) return
      const base = child.userData.globalBase
      const numSegments = child.userData.numSegments
      if (revealed >= base + numSegments) {
        child.visible = true
        this.setRevealCount(child, numSegments)
      } else if (revealed <= base) {
        child.visible = false
      } else {
        child.visible = true
        this.setRevealCount(child, revealed - base)
      }
    })

    // Grow the segment the nozzle is mid-way through
    this.updateTipLine(spot)
  }

  /**
   * Limits how many of a layer's segments are drawn
   * @param child - Layer line object
   * @param count - Segments to draw
   * @returns True if the count changed
   */
  setRevealCount (child: LayerLine, count: number) {
    // Thick lines are instanced; thin ones aren't, so limit their drawn vertex range (2 per segment)
    if (this.settings.thickLines) {
      const geometry = child.geometry as THREE.LineSegmentsGeometry
      if (geometry.instanceCount === count) return false
      geometry.instanceCount = count
    } else {
      const geometry = child.geometry
      if (geometry.drawRange.count === count * 2) return false
      geometry.setDrawRange(0, count * 2)
    }
    return true
  }

  /* ---- Growing tip line ---- */

  /** (Re)creates the line used to draw the partially printed segment */
  buildTipLine () {
    if (this.tipLine) {
      this.linesGroup.remove(this.tipLine)
      this.tipLine.geometry.dispose()
    }

    const positions = new Float32Array(6)
    const colors = new Float32Array(6)
    let line: LayerLine
    if (this.settings.thickLines) {
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
    this.linesGroup.add(line)
  }

  /**
   * Grows the partially printed segment's line up to a timeline position
   * @param spot - Timeline position
   */
  updateTipLine (spot: TimelineSpot) {
    const tipLine = this.tipLine
    if (!tipLine) return

    // Nothing grows while traveling between segments or past the end
    if (!spot.onSegment || spot.fraction <= 0) {
      tipLine.visible = false
      return
    }

    const segment = this.timeline.segmentAt(spot.segmentIndex)!
    const vertices = segment.layer.vertices
    const offset = segment.localIndex * 6
    const startX = vertices[offset]; const startY = vertices[offset + 1]; const startZ = vertices[offset + 2]

    // Grow up to how far along the segment the nozzle has reached
    const progress = spot.fraction
    const colors = segment.layer.colors
    this.setTipLineGeometry(startX, startY, startZ,
      startX + (vertices[offset + 3] - startX) * progress, startY + (vertices[offset + 4] - startY) * progress, startZ + (vertices[offset + 5] - startZ) * progress,
      colors[offset], colors[offset + 1], colors[offset + 2])
    tipLine.visible = true
  }

  /**
   * Writes new endpoints and color into the tip line
   * @param startX - Start point X
   * @param startY - Start point Y
   * @param startZ - Start point Z
   * @param endX - End point X
   * @param endY - End point Y
   * @param endZ - End point Z
   * @param r - Red component (0-1)
   * @param g - Green component (0-1)
   * @param b - Blue component (0-1)
   */
  setTipLineGeometry (startX: number, startY: number, startZ: number, endX: number, endY: number, endZ: number, r: number, g: number, b: number) {
    if (!this.tipLine) return

    const geometry = this.tipLine.geometry
    if (this.settings.thickLines) {
      const attributes = geometry.attributes as Record<string, THREE.InterleavedBufferAttribute>
      const positions = attributes.instanceStart.data
      positions.array.set([startX, startY, startZ, endX, endY, endZ])
      positions.needsUpdate = true
      const colors = attributes.instanceColorStart.data
      colors.array.set([r, g, b, r, g, b])
      colors.needsUpdate = true
    } else {
      geometry.attributes.position.array.set([startX, startY, startZ, endX, endY, endZ])
      geometry.attributes.position.needsUpdate = true
      geometry.attributes.color.array.set([r, g, b, r, g, b])
      geometry.attributes.color.needsUpdate = true
    }
  }
}
