import { clampOverlayHeight, defaultOverlayHeight, makeResizable } from './overlay-windows'
import type { Overlay } from './overlay-windows'
import type { Settings } from '../settings'

/**
 * Resizes the dashboard overlay
 * @param height - Height in px
 */
function applyDashboardHeight (height: number) {
  const dashboardElement = document.getElementById('tab_plugin_dashboard')
  if (!dashboardElement) return

  const target = clampOverlayHeight(height)

  // The overlay is a scaled miniature: derive the scale from the content's natural height
  if (dashboardElement.offsetHeight) dashboardElement.style.setProperty('--pg-dash-scale', String(target / dashboardElement.offsetHeight))
}

/**
 * Shows or hides the dashboard overlay to match the current settings
 * @param settings - Plugin frontend settings
 */
export function updateDashboardOverlay (settings: Settings) {
  $('#tab_plugin_dashboard').toggleClass('pg-hidden', !settings.showDashboard)
  if (settings.showDashboard && $('.page-container').hasClass('pg-maximized')) applyDashboardHeight(settings.dashboardHeight || defaultOverlayHeight())
}

/**
 * Creates the dashboard overlay
 * @param settings - Plugin frontend settings
 */
export function initDashboardOverlay (settings: Settings) {
  const $dashboard = $('#tab_plugin_dashboard')
  if (!$dashboard.length) return

  const dashboardOverlay: Overlay = {
    measure () {
      const rect = $dashboard[0].getBoundingClientRect()
      return { width: rect.width, height: rect.height }
    },
    apply (height: number) {
      settings.dashboardHeight = Math.round(clampOverlayHeight(height))
      applyDashboardHeight(settings.dashboardHeight)
    },
    persist: () => settings.save()
  }

  $dashboard.append('<div class="pg-resize-handle pg-resize-top"></div><div class="pg-resize-handle pg-resize-right"></div>')
  makeResizable($dashboard.children('.pg-resize-top'), dashboardOverlay, 'y', -1)
  makeResizable($dashboard.children('.pg-resize-right'), dashboardOverlay, 'x', 1)

  // The dashboard fills in asynchronously after startup: keep the height in step with its content
  const contentObserver = new ResizeObserver(() => updateDashboardOverlay(settings))
  contentObserver.observe($dashboard[0])
}
