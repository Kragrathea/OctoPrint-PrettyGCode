import { initWebcamOverlay, updateWebcamOverlay } from './webcam'
import { initDashboardOverlay, updateDashboardOverlay } from './dashboard'
import { applyStatusBarVisibility } from './status-bar'
import type { PrettyGCodeApp } from '../app'

/** A resizable overlay that scales through a single driver value (webcam height in px, dashboard scale) */
export interface Overlay {
  measure: () => { driver: number, width: number, height: number }
  apply: (driver: number) => void
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
 * Shows or hides the windows and overlays to match the current settings
 * @param app - Application instance
 */
export function updateWindowStates (app: PrettyGCodeApp) {
  applyStatusBarVisibility(app.settings.showStatusBar)

  $('#state_wrapper').toggleClass('pg-hidden', !app.settings.showState)
  $('#files_wrapper').toggleClass('pg-hidden', !app.settings.showFiles)

  updateDashboardOverlay(app)
  updateWebcamOverlay(app)
}

/**
 * Makes an overlay resizable by dragging a handle, scaling its driver value proportionally
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

    const startState = overlay.measure()
    const startCoord = pointerEvent[pointerCoord]
    const startDimension = axis === 'x' ? startState.width : startState.height
    if (this.setPointerCapture) this.setPointerCapture(pointerEvent.pointerId)

    const onMove = (ev: JQuery.TriggeredEvent) => {
      const delta = direction * (((ev.originalEvent ?? ev) as PointerEvent)[pointerCoord] - startCoord)
      if (startDimension) overlay.apply(startState.driver * (startDimension + delta) / startDimension)
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
 * @param app - Application instance
 */
export function initOverlayWindows (app: PrettyGCodeApp) {
  initWebcamOverlay(app)
  initDashboardOverlay(app)
}
