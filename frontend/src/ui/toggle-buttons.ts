import type { PrettyGCodeApp } from '../app'

/** Settings keys of the toggleable windows */
type WindowKey = 'showState' | 'showFiles' | 'showWebcam' | 'showDashboard'

/** Last known maximized state */
let wasMaximized = false

/**
 * Wires the view's toggle buttons
 * @param app - Application instance
 */
export function initToggleButtons (app: PrettyGCodeApp) {
  /**
   * Toggles a window open or closed
   * @param key - Settings key of the window to toggle
   * @param closes - Settings key of the window to close when the toggled one opens
   */
  const toggleWindow = (key: WindowKey, closes?: WindowKey) => {
    app.settings[key] = !app.settings[key]
    if (app.settings[key] && closes) app.settings[closes] = false
    app.settings.save()
    app.updateWindowStates()
  }

  // Restore the maximized layout from the URL (bookmarked/embedded maximized view)
  if (new URLSearchParams(location.search).get('maximized')) $('.page-container').addClass('pg-maximized')

  $('.pg-toggle-maximized').on('click', () => {
    if (document.fullscreenElement) {
      document.exitFullscreen()
      return
    }

    // Update maximized parameter in URL
    const maximized = $('.page-container').toggleClass('pg-maximized').hasClass('pg-maximized')
    const url = new URL(window.location.href)
    if (maximized) url.searchParams.set('maximized', '1')
    else url.searchParams.delete('maximized')
    history.replaceState(null, '', url)

    app.updateWindowStates()
  })

  $('.pg-toggle-fullscreen').on('click', () => {
    if (document.fullscreenElement) {
      document.exitFullscreen()
    } else {
      // Remember the maximized state from before entering fullscreen, to restore it on exit
      wasMaximized = $('.page-container').hasClass('pg-maximized')

      $('.page-container').addClass('pg-maximized')
      $('.page-container')[0].requestFullscreen()

      app.updateWindowStates()
    }
  })
  $(document).on('fullscreenchange', () => {
    if (!document.fullscreenElement) {
      // Leaving fullscreen restores the maximized state from before entering it
      $('.page-container').toggleClass('pg-maximized', wasMaximized)
      app.updateWindowStates()
    }
  })

  $('.pg-toggle-state').on('click', () => toggleWindow('showState', 'showFiles'))
  $('.pg-toggle-files').on('click', () => toggleWindow('showFiles', 'showState'))
  $('.pg-reset-view').on('click', () => app.resetView())

  $('.pg-toggle-settings').on('click', () => $('#pg-view-settings').toggleClass('pg-hidden'))

  $('.pg-toggle-dashboard').on('click', () => toggleWindow('showDashboard'))
  $('.pg-toggle-webcam').on('click', () => toggleWindow('showWebcam'))
}
