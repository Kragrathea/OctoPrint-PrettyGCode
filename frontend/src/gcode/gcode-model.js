import * as THREE from '../three-exports.js'

// Layer names
const LAYER_PREFIX = 'layer#'
const isLayerObject = (child) => child.name.startsWith(LAYER_PREFIX)

// Lines thickness based on nozzle size
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

export class GCodeModel {
  // Group holding the gcode model lines
  linesGroup = new THREE.Group()

  // Layers last built from, kept to rebuild when settings change
  layers = []

  // The growing tip drawn along the segment the nozzle is currently laying down
  tipLine = null

  // Line materials for the gcode model
  thinMaterial = makeThinMaterial()
  thickMaterial = makeThickMaterial()
  highlightMaterial = makeHighlightMaterial()

  constructor (settings, timeline, mirrorBoundsPlanes) {
    this.settings = settings
    this.timeline = timeline

    // Mirror materials, clipped to the bed
    this.mirrorThickMaterial = makeThickMaterial(mirrorBoundsPlanes)
    this.mirrorThinMaterial = makeThinMaterial(mirrorBoundsPlanes)
  }

  /* ---- Object building ---- */

  build (layers) {
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

  rebuild () {
    // Rebuild the 3D object from already-parsed data, e.g. when settings/materials change
    this.build(this.layers)
  }

  makeLine (vertices, colors, material) {
    if (this.settings.thickLines) {
      // Thick lines
      const geometry = new THREE.LineSegmentsGeometry()
      geometry.setPositions(vertices)
      geometry.setColors(colors)
      return new THREE.LineSegments2(geometry, material)
    } else {
      // Thin lines
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
      return new THREE.LineSegments(geometry, material)
    }
  }

  addLayerLines (layer, layerNumber) {
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

  makeMirrorData (layer) {
    // Mirror through the bed: flip the Z of every vertex
    const vertices = layer.vertices.slice()
    for (let i = 2; i < vertices.length; i += 3) vertices[i] = -vertices[i]

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

    return { vertices, colors }
  }

  applyLineWidth (nozzleDiameter) {
    const lineWidth = (nozzleDiameter ?? DEFAULT_NOZZLE_DIAMETER) * LINE_THICKNESS_FACTOR

    this.thickMaterial.linewidth = lineWidth
    this.mirrorThickMaterial.linewidth = lineWidth
    this.highlightMaterial.linewidth = lineWidth
  }

  /* ---- Reveal and highlight ---- */

  highlightLayer (layerNumber) {
    // Highlight material works only on thick lines
    if (!this.settings.thickLines) return

    this.linesGroup.traverse((child) => {
      if (!isLayerObject(child)) return

      // The mirror keeps its own bed-clipped material
      if (child.userData.mirror) return

      // Highlight the target layer, default on the others
      child.material = child.userData.layerNumber === layerNumber ? this.highlightMaterial : this.thickMaterial
    })
  }

  syncToLayer (layerNumber) {
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

  revealTo (spot) {
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

  setRevealCount (child, count) {
    // Thick lines are instanced; thin ones aren't, so limit their drawn vertex range (2 per segment)
    const geometry = child.geometry
    if (this.settings.thickLines) {
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
      this.linesGroup.remove(this.tipLine)
      this.tipLine.geometry.dispose()
    }

    const positions = new Float32Array(6)
    const colors = new Float32Array(6)
    let line
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

  updateTipLine (spot) {
    const tipLine = this.tipLine
    if (!tipLine) return

    // Nothing grows while traveling between segments or past the end
    if (!spot.onSegment || spot.fraction <= 0) {
      tipLine.visible = false
      return
    }

    const segment = this.timeline.segmentAt(spot.segmentIndex)
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

  setTipLineGeometry (startX, startY, startZ, endX, endY, endZ, r, g, b) {
    const geometry = this.tipLine.geometry
    if (this.settings.thickLines) {
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
}
