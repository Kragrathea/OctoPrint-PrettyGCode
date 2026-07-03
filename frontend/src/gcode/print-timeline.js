import * as THREE from '../three-exports.js'

// How far behind the live print the shown nozzle trails to absorb bursty updates.
// Higher looks smoother but lags real time more, lower tracks tighter but can stutter.
const NOZZLE_LAG_SECONDS = 1.5
// A read position leaping farther ahead than this (a seek, a mid-print reload) snaps instead of sweeping the whole way
const NOZZLE_SNAP_SECONDS = 120

export class PrintTimeline {
  // Drawn segments indexed for lookup across layers
  drawnLayers = []
  totalSegments = 0

  // Cumulative estimated time(s) at each drawn segment's start/end, travel gaps included
  segmentStartTimes = null
  segmentEndTimes = null

  // The nozzle eased along the estimated timeline: where it is and where the read position points
  nozzleTime = 0
  targetTime = 0
  nozzlePosition = new THREE.Vector3()

  index (layers) {
    // Flatten the drawn layers into print order, tracking each one's running segment offset
    this.drawnLayers = []
    let base = 0
    layers.forEach((layer, i) => {
      if (layer.vertices.length <= 2) return // empty layers have no drawn object
      const numSegments = layer.vertices.length / 6
      this.drawnLayers.push({ layerNumber: i + 1, globalBase: base, numSegments, vertices: layer.vertices, colors: layer.colors, filePositions: layer.filePositions, durations: layer.durations })
      base += numSegments
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

    // Start the nozzle from scratch on the new timeline
    this.nozzleTime = 0
    this.targetTime = 0
  }

  advance (filePosition, deltaSeconds) {
    if (!this.drawnLayers.length) return null

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
    this.updateNozzlePosition(spot)
    return spot
  }

  layerNumberAt (segmentIndex) {
    // Layer holding the last revealed segment
    let layerNumber = 0
    for (const layer of this.drawnLayers) {
      if (segmentIndex <= layer.globalBase) break
      layerNumber = layer.layerNumber
    }
    return layerNumber
  }

  segmentsReadAt (filePosition) {
    // How many drawn segments the read position has reached
    let count = 0

    for (const layer of this.drawnLayers) {
      const filePositions = layer.filePositions
      if (filePositions[0] > filePosition) break
      if (filePositions[filePositions.length - 1] < filePosition) {
        count = layer.globalBase + layer.numSegments
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
    if (lo >= ends.length) return { segmentIndex: ends.length, fraction: 1, onSegment: false }

    if (time >= starts[lo]) {
      const duration = ends[lo] - starts[lo]
      return { segmentIndex: lo, fraction: duration > 0 ? (time - starts[lo]) / duration : 1, onSegment: true }
    }
    const gapStart = lo > 0 ? ends[lo - 1] : 0
    const gap = starts[lo] - gapStart
    return { segmentIndex: lo, fraction: gap > 0 ? (time - gapStart) / gap : 0, onSegment: false }
  }

  updateNozzlePosition (spot) {
    const position = this.nozzlePosition

    // Past the end: park on the last segment's endpoint
    if (spot.segmentIndex >= this.totalSegments) {
      const last = this.segmentAt(this.totalSegments - 1)
      position.fromArray(last.layer.vertices, last.localIndex * 6 + 3)
      return
    }

    const segment = this.segmentAt(spot.segmentIndex)
    const vertices = segment.layer.vertices
    const offset = segment.localIndex * 6

    if (spot.onSegment) {
      // Along the segment being drawn
      position.set(
        vertices[offset] + (vertices[offset + 3] - vertices[offset]) * spot.fraction,
        vertices[offset + 1] + (vertices[offset + 4] - vertices[offset + 1]) * spot.fraction,
        vertices[offset + 2] + (vertices[offset + 5] - vertices[offset + 2]) * spot.fraction
      )
    } else if (spot.segmentIndex > 0) {
      // In a travel gap: glide from the previous segment's end to this one's start
      const previous = this.segmentAt(spot.segmentIndex - 1)
      const from = previous.layer.vertices
      const fromOffset = previous.localIndex * 6
      position.set(
        from[fromOffset + 3] + (vertices[offset] - from[fromOffset + 3]) * spot.fraction,
        from[fromOffset + 4] + (vertices[offset + 1] - from[fromOffset + 4]) * spot.fraction,
        from[fromOffset + 5] + (vertices[offset + 2] - from[fromOffset + 5]) * spot.fraction
      )
    } else {
      // Wait at the start of the segment
      position.fromArray(vertices, offset)
    }
  }

  getNozzlePosition () {
    // Not meaningful until the print reaches the first segment (e.g. homing, heating)
    return this.targetTime > 0 ? this.nozzlePosition : null
  }

  segmentAt (globalIndex) {
    for (const layer of this.drawnLayers) {
      if (globalIndex < layer.globalBase + layer.numSegments) return { layer, localIndex: globalIndex - layer.globalBase }
    }
    return null
  }
}
