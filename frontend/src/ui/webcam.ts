import { clampOverlayHeight, defaultOverlayHeight, makeResizable } from './overlay-windows'
import type { Overlay } from './overlay-windows'
import type { PrettyGCodeApp } from '../app'

/** Placeholder for restoring the webcam containers to their original position */
let restorePlaceholder: Comment | null = null

/** Webcam overlay target height in px */
let webcamHeight = 0

/**
 * Finds OctoPrint's webcam containers
 * @returns The webcam plugins container (on OctoPrint 1.9+) or the legacy control tab containers
 */
function getWebcamContainers () {
  const plugins = $('#webcam_plugins_container')
  return plugins.length ? plugins : $('#webcam_video_container, #webcam_container')
}

/**
 * Resizes the webcam overlay
 * @param height - Height in px
 */
function setWebcamHeight (height: number) {
  const overlay = $('#pg-webcam')
  if (!overlay.length) return

  webcamHeight = clampOverlayHeight(height)

  // The docked content derives its height from the width, so steer the width toward the target height
  const rect = overlay[0].getBoundingClientRect()
  if (Math.abs(rect.height - webcamHeight) < 1) return
  const aspect = rect.height ? rect.width / rect.height : 16 / 9
  overlay.css('width', Math.round(webcamHeight * aspect) + 'px')
}

/**
 * Starts the stream on OctoPrint <= 1.8, whose control view model refuses to stream while its tab is not the selected one
 * @param controlVM - OctoPrint control view model
 */
function legacyEnableWebcam (controlVM: any) {
  clearTimeout(controlVM.webcamDisableTimeout)
  controlVM.webcamDisableTimeout = undefined

  const selectedTab = OctoPrint.coreui.selectedTab
  OctoPrint.coreui.selectedTab = '#control'
  try {
    controlVM._enableWebcam()
  } finally {
    OctoPrint.coreui.selectedTab = selectedTab
  }
}

/** Moves the webcam containers into the overlay window */
function dockWebcam () {
  const containers = getWebcamContainers()
  if (!containers.length || containers.parent().is('#pg-webcam')) return

  // Keep the placeholder from the first dock if another plugin moved the containers meanwhile
  if (!restorePlaceholder) {
    restorePlaceholder = document.createComment('pg-webcam-placeholder')
    containers[0].before(restorePlaceholder)
  }
  containers.prependTo('#pg-webcam')

  const controlVM = OctoPrint.coreui.viewmodels?.controlViewModel
  if (containers.is('#webcam_plugins_container')) {
    // OctoPrint 1.9+ detects visibility with an IntersectionObserver and start the streams on its own
    controlVM?.recreateIntersectionObservers?.()
  } else if (controlVM) {
    // Reclaim pieces UICustomizer may have moved to its sidebar widget or hidden
    if ($('#UICWebCamWidget').length) {
      const rotator = $('#webcam_rotator')
      if (!rotator.closest('#webcam_container').length) $('#webcam_container').append(rotator)
      containers.removeClass('UICHideHard').css('display', '')
    }

    // Start the streams on OctoPrint < 1.9
    legacyEnableWebcam(controlVM)
  }
}

/** Puts the webcam containers back in their original position */
function undockWebcam () {
  if (!restorePlaceholder) return

  const placeholder = restorePlaceholder
  const containers = getWebcamContainers()
  if (containers.parent().is('#pg-webcam')) containers.each(function () { placeholder.before(this) })
  placeholder.remove()
  restorePlaceholder = null

  const controlVM = OctoPrint.coreui.viewmodels?.controlViewModel
  if (containers.is('#webcam_plugins_container')) {
    // OctoPrint 1.9+ detects visibility with an IntersectionObserver and stop the streams on its own
    controlVM?.recreateIntersectionObservers?.()
  } else {
    // Stop the streams on OctoPrint < 1.9
    controlVM?._disableWebcam?.()
  }
}

/**
 * Shows or hides the webcam overlay to match the current settings, docking or undocking the webcam containers
 * @param app - Application instance
 */
export function updateWebcamOverlay (app: PrettyGCodeApp) {
  const webcamContainersAvailable = getWebcamContainers().length > 0

  $('.pg-view #pg-webcam').toggleClass('pg-hidden', !app.settings.showWebcam || !webcamContainersAvailable)
  if (app.settings.showWebcam) setWebcamHeight(app.settings.webcamHeight || defaultOverlayHeight())

  // Dock only while the overlay is actually visible: our tab selected, maximized, and the setting enabled
  const visible = webcamContainersAvailable && app.settings.showWebcam &&
    OctoPrint.coreui.selectedTab === '#tab_plugin_prettygcode' && $('.page-container').hasClass('pg-maximized')
  if (visible) dockWebcam()
  else undockWebcam()
}

/**
 * Creates the webcam overlay
 * @param app - Application instance
 */
export function initWebcamOverlay (app: PrettyGCodeApp) {
  const webcamOverlay: Overlay = {
    measure () {
      const rect = $('#pg-webcam')[0].getBoundingClientRect()
      return { driver: rect.height, width: rect.width, height: rect.height }
    },
    apply: setWebcamHeight,
    persist () {
      app.settings.webcamHeight = Math.round($('#pg-webcam').height() ?? 0)
      app.settings.save()
    }
  }

  $('.pg-view').append('<div id="pg-webcam"><div class="pg-resize-handle pg-resize-top"></div><div class="pg-resize-handle pg-resize-left"></div></div>')
  setWebcamHeight(app.settings.webcamHeight || defaultOverlayHeight())
  makeResizable($('#pg-webcam .pg-resize-top'), webcamOverlay, 'y', -1)
  makeResizable($('#pg-webcam .pg-resize-left'), webcamOverlay, 'x', -1)

  // The stream sizes in after loading: keep the height in step with the target height
  const contentObserver = new ResizeObserver(() => { if (webcamHeight) setWebcamHeight(webcamHeight) })
  contentObserver.observe($('#pg-webcam')[0])
}
