import { updateWindowStates } from './overlay-windows'
import type { PrettyGCodeApp } from '../app'

let wasMaximized = false

export function initToggleButtons (app: PrettyGCodeApp) {
  // Flip a window setting and refresh the overlays accordingly
  const toggleWindow = (key: 'showState' | 'showFiles' | 'showWebcam' | 'showDashboard') => {
    app.settings[key] = !app.settings[key]
    app.settings.save()
    updateWindowStates(app)
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

    updateWindowStates(app)
  })

  $('.pg-toggle-fullscreen').on('click', () => {
    if (document.fullscreenElement) {
      document.exitFullscreen()
    } else {
      // Remember the maximized state from before entering fullscreen, to restore it on exit
      wasMaximized = $('.page-container').hasClass('pg-maximized')

      $('.page-container').addClass('pg-maximized')
      $('.page-container')[0].requestFullscreen()

      updateWindowStates(app)
    }
  })
  $(document).on('fullscreenchange', () => {
    if (!document.fullscreenElement) {
      // Leaving fullscreen restores the maximized state from before entering it
      $('.page-container').toggleClass('pg-maximized', wasMaximized)
      updateWindowStates(app)
    }
  })

  $('.pg-toggle-settings').on('click', () => $('#pg-view-settings').toggleClass('pg-hidden'))

  $('.pg-toggle-state').on('click', () => toggleWindow('showState'))
  $('.pg-toggle-files').on('click', () => toggleWindow('showFiles'))
  $('.pg-toggle-webcam').on('click', () => toggleWindow('showWebcam'))
  $('.pg-toggle-dashboard').on('click', () => toggleWindow('showDashboard'))
}
