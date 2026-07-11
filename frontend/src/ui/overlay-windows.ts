import { initWebcamOverlay } from './webcam'
import { initDashboardOverlay } from './dashboard'
import type { Settings } from '../settings'

/** A resizable overlay sized through its height in px */
export interface Overlay {
  measure: () => { width: number, height: number }
  apply: (height: number) => void
  persist: () => void
}

/** Minimum overlay height in px */
const MIN_OVERLAY_HEIGHT = 50
/** Maximum overlay height as a share of the viewport height */
const MAX_OVERLAY_HEIGHT_FRACTION = 0.9
/** Default overlay height as a share of the viewport height */
const DEFAULT_OVERLAY_HEIGHT_FRACTION = 1 / 3

/**
 * Computes the default overlay height for the current viewport
 * @returns Height in px
 */
export function defaultOverlayHeight () {
  return Math.round(window.innerHeight * DEFAULT_OVERLAY_HEIGHT_FRACTION)
}

/**
 * Clamps an overlay height to the allowed range
 * @param height - Desired height in px
 * @returns The clamped height in px
 */
export function clampOverlayHeight (height: number) {
  return Math.min(window.innerHeight * MAX_OVERLAY_HEIGHT_FRACTION, Math.max(MIN_OVERLAY_HEIGHT, height))
}

/**
 * Makes an overlay resizable by dragging a handle, scaling its height proportionally to the drag
 * @param $handle - Drag handle element
 * @param overlay - Overlay to resize
 * @param axis - Pointer axis the drag follows
 * @param direction - 1 if dragging along the axis grows the overlay, -1 otherwise
 */
export function makeResizable ($handle: JQuery, overlay: Overlay, axis: 'x' | 'y', direction: 1 | -1) {
  const pointerCoord = axis === 'x' ? 'clientX' : 'clientY'
  $handle.on('pointerdown', function (e) {
    const pointerEvent = (e.originalEvent ?? e) as PointerEvent
    e.preventDefault()
    e.stopPropagation()

    const startSize = overlay.measure()
    const startCoord = pointerEvent[pointerCoord]
    const startDimension = axis === 'x' ? startSize.width : startSize.height
    if (this.setPointerCapture) this.setPointerCapture(pointerEvent.pointerId)

    const onMove = (ev: JQuery.TriggeredEvent) => {
      const delta = direction * (((ev.originalEvent ?? ev) as PointerEvent)[pointerCoord] - startCoord)
      if (startDimension) overlay.apply(startSize.height * (startDimension + delta) / startDimension)
    }
    const onUp = () => {
      $handle.off('pointermove', onMove).off('pointerup pointercancel', onUp)
      overlay.persist()
    }
    $handle.on('pointermove', onMove).on('pointerup pointercancel', onUp)
  })
}

/**
 * Creates the overlays
 * @param settings - Plugin frontend settings
 */
export function initOverlayWindows (settings: Settings) {
  initWebcamOverlay(settings)
  initDashboardOverlay(settings)
}
