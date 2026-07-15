import * as THREE from '../three-exports'
import type { Settings } from '../settings'
import type { Layer } from './parser'
import type { PrintExclusions } from './exclusions'
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

/** The rendered gcode model, made of per-layer line objects */
export class GCodeModel {
  /** Group holding the gcode model lines */
  readonly linesGroup = new THREE.Group()

  /** Layers the model was last built from */
  private layers: Layer[] = []

  /** The growing tip drawn along the segment the nozzle is currently laying down */
  private tipLine: LayerLine | null = null

  /** Material for thin lines */
  private readonly thinMaterial = makeThinMaterial()
  /** Material for thick lines */
  private readonly thickMaterial = makeThickMaterial()
  /** Thin line material for the highlighted layer */
  private readonly highlightThinMaterial = makeThinMaterial()
  /** Thick line material for the highlighted layer */
  private readonly highlightThickMaterial = makeThickMaterial()

  /** Thick line material for the mirror, clipped to the bed */
  private readonly mirrorThickMaterial: THREE.LineMaterial
  /** Thin line material for the mirror, clipped to the bed */
  private readonly mirrorThinMaterial: THREE.LineBasicMaterial

  /** Plugin frontend settings */
  private readonly settings: Settings

  /** Print timeline of the loaded gcode */
  private readonly timeline: PrintTimeline

  /** Print exclusions of the loaded gcode */
  private readonly exclusions: PrintExclusions

  /**
   * @param settings - Plugin frontend settings
   * @param timeline - Print timeline of the loaded gcode
   * @param exclusions - Print exclusions of the loaded gcode
   * @param mirrorBoundsPlanes - Planes clipping the mirror to the bed
   */
  constructor (settings: Settings, timeline: PrintTimeline, exclusions: PrintExclusions, mirrorBoundsPlanes: THREE.Plane[]) {
    this.settings = settings
    this.timeline = timeline
    this.exclusions = exclusions

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
  private makeLine (vertices: number[], colors: number[], material: THREE.LineMaterial | THREE.LineBasicMaterial): LayerLine {
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
  private addLayerLines (layer: Layer, layerNumber: number) {
    // Skip empty layers
    if (layer.vertices.length <= 2) return

    // Layers untouched by exclusions go in whole
    const excludedFlags = this.exclusions.classifyLayer(layer)
    if (!excludedFlags) {
      this.addLayerPart(layer, layerNumber, layer.vertices, layer.colors, null)
      return
    }

    // Split the layer between printed and excluded segments
    const printedPart = { vertices: [] as number[], colors: [] as number[], segmentIndices: [] as number[] }
    const excludedPart = { vertices: [] as number[], colors: [] as number[], segmentIndices: [] as number[] }
    for (let segment = 0; segment < excludedFlags.length; segment++) {
      const part = excludedFlags[segment] ? excludedPart : printedPart
      const offset = segment * 6
      for (let i = 0; i < 6; i++) {
        part.vertices.push(layer.vertices[offset + i])
        part.colors.push(layer.colors[offset + i])
      }
      part.segmentIndices.push(segment)
    }

    // Add the printed part
    this.addLayerPart(layer, layerNumber, printedPart.vertices, printedPart.colors, new Uint32Array(printedPart.segmentIndices))

    // Add the excluded part, greyed out
    if (this.settings.showExcluded) {
      this.greyOutColors(excludedPart.colors)
      this.addLayerPart(layer, layerNumber, excludedPart.vertices, excludedPart.colors, new Uint32Array(excludedPart.segmentIndices))
    }
  }

  /**
   * Adds one part of a layer's segments to the model
   * @param layer - Parsed layer
   * @param layerNumber - 1-based layer number
   * @param vertices - Segment endpoints as flat XYZ triplets
   * @param colors - Vertex colors as flat RGB triplets
   * @param segmentIndices - Indices of the part's segments in the layer, or null for the whole layer
   */
  private addLayerPart (layer: Layer, layerNumber: number, vertices: number[], colors: number[], segmentIndices: Uint32Array | null) {
    // Skip empty parts
    if (vertices.length <= 2) return

    const thickLines = this.settings.thickLines

    // Per-part metadata
    const userData = {
      layerZ: layer.z,
      layerNumber,
      numSegments: vertices.length / 6,
      segmentIndices
    }

    // Build the part's line object and add it to the gcode group
    const line = this.makeLine(vertices, colors, thickLines ? this.thickMaterial : this.thinMaterial)
    line.name = LAYER_PREFIX + layerNumber
    line.userData = userData
    this.linesGroup.add(line)

    // Build and add the part's line object to the mirror
    if (this.settings.showMirror) {
      const mirrorData = this.makeMirrorData(vertices, colors)
      const mirror = this.makeLine(mirrorData.vertices, mirrorData.colors, thickLines ? this.mirrorThickMaterial : this.mirrorThinMaterial)
      mirror.name = LAYER_PREFIX + layerNumber
      mirror.userData = { ...userData, mirror: true }
      this.linesGroup.add(mirror)
    }
  }

  /**
   * Derives geometry mirrored through the bed
   * @param layerVertices - Segment endpoints as flat XYZ triplets
   * @param layerColors - Vertex colors as flat RGB triplets
   * @returns The mirror's vertices and colors
   */
  private makeMirrorData (layerVertices: number[], layerColors: number[]) {
    // Mirror through the bed: flip the Z of every vertex
    const vertices = layerVertices.slice()
    for (let i = 2; i < vertices.length; i += 3) vertices[i] = -vertices[i]

    // Halve each color's lightness so the reflection reads as dimmer
    const colors = layerColors.slice()
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
   * Turns colors into their greyed-out version
   * @param colors - Vertex colors as flat RGB triplets, modified in place
   */
  private greyOutColors (colors: number[]) {
    const color = new THREE.Color()
    const hsl = { h: 0, s: 0, l: 0 }
    for (let i = 0; i < colors.length; i += 3) {
      color.setRGB(colors[i], colors[i + 1], colors[i + 2])
      color.getHSL(hsl)
      color.setHSL(hsl.h, 0, hsl.l * 0.6)
      colors[i] = color.r
      colors[i + 1] = color.g
      colors[i + 2] = color.b
    }
  }

  /**
   * Sets the drawn line thickness from the nozzle size
   * @param nozzleDiameter - Nozzle diameter in mm, or null for the default
   */
  applyLineWidth (nozzleDiameter: number | null) {
    const lineWidth = (nozzleDiameter ?? DEFAULT_NOZZLE_DIAMETER) * LINE_THICKNESS_FACTOR

    this.thickMaterial.linewidth = lineWidth
    this.mirrorThickMaterial.linewidth = lineWidth
    this.highlightThickMaterial.linewidth = lineWidth
  }

  /* ---- Reveal and highlight ---- */

  /**
   * Highlights a layer, unhighlighting the others
   * @param layerNumber - 1-based layer number to highlight
   */
  highlightLayer (layerNumber: number) {
    // Shade the highlight materials by the set intensity
    const brightness = 1 - this.settings.highlightIntensity / 100
    this.highlightThinMaterial.color.setRGB(brightness, brightness, brightness)
    this.highlightThickMaterial.color.setRGB(brightness, brightness, brightness)

    const thickLines = this.settings.thickLines
    const highlightMaterial = thickLines ? this.highlightThickMaterial : this.highlightThinMaterial
    const defaultMaterial = thickLines ? this.thickMaterial : this.thinMaterial

    this.linesGroup.traverse((child) => {
      if (!isLayerObject(child)) return

      // The mirror keeps its own bed-clipped material
      if (child.userData.mirror) return

      // Highlight the target layer, default on the others
      child.material = this.settings.highlightIntensity > 0 && child.userData.layerNumber === layerNumber ? highlightMaterial : defaultMaterial
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

    // Show each part's segments up to the reveal position, hide parts it hasn't reached
    this.linesGroup.traverse((child) => {
      if (!isLayerObject(child)) return
      const count = this.partRevealCount(child, revealed)
      child.visible = count > 0
      if (count > 0) this.setRevealCount(child, count)
    })

    // Grow the segment the nozzle is mid-way through
    this.updateTipLine(spot)
  }

  /**
   * Counts how many of a part's segments a reveal position has passed
   * @param child - Layer line object
   * @param revealed - Global index of the reveal position
   * @returns The number of segments passed
   */
  private partRevealCount (child: LayerLine, revealed: number) {
    // How many of the layer's segments the reveal has passed
    const revealedInLayer = revealed - child.userData.globalBase
    const numSegments = child.userData.numSegments

    // A whole layer is drawn up to the reveal, capped to its own size
    const segmentIndices: Uint32Array | null = child.userData.segmentIndices
    if (!segmentIndices) return Math.max(0, Math.min(numSegments, revealedInLayer))

    // A split part counts its segments the reveal has passed (binary search)
    let lo = 0; let hi = numSegments
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (segmentIndices[mid] < revealedInLayer) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  /**
   * Limits how many of a layer's segments are drawn
   * @param child - Layer line object
   * @param count - Segments to draw
   * @returns True if the count changed
   */
  private setRevealCount (child: LayerLine, count: number) {
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
  private buildTipLine () {
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
      line = new THREE.LineSegments2(geometry, this.highlightThickMaterial)
    } else {
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
      line = new THREE.LineSegments(geometry, this.highlightThinMaterial)
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
  private updateTipLine (spot: TimelineSpot) {
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
  private setTipLineGeometry (startX: number, startY: number, startZ: number, endX: number, endY: number, endZ: number, r: number, g: number, b: number) {
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
