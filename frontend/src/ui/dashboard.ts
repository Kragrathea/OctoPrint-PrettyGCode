import { clampOverlayHeight, defaultOverlayHeight, makeResizable } from './overlay-windows'
import type { Overlay } from './overlay-windows'
import type { PrettyGCodeApp } from '../app'

/** Dashboard overlay target height in px */
let dashboardHeight = 0

/**
 * Resizes the dashboard overlay
 * @param height - Height in px
 */
function setDashboardHeight (height: number) {
  const dashboardElement = document.getElementById('tab_plugin_dashboard')
  if (!dashboardElement) return

  dashboardHeight = clampOverlayHeight(height)

  // The overlay is a scaled miniature: derive the scale from the content's natural height
  if (dashboardElement.offsetHeight) dashboardElement.style.setProperty('--pg-dash-scale', String(dashboardHeight / dashboardElement.offsetHeight))
}

/**
 * Shows or hides the dashboard overlay to match the current settings
 * @param app - Application instance
 */
export function updateDashboardOverlay (app: PrettyGCodeApp) {
  $('#tab_plugin_dashboard').toggleClass('pg-hidden', !app.settings.showDashboard)
  if (app.settings.showDashboard && $('.page-container').hasClass('pg-maximized')) setDashboardHeight(app.settings.dashboardHeight || defaultOverlayHeight())
}

/**
 * Creates the dashboard overlay
 * @param app - Application instance
 */
export function initDashboardOverlay (app: PrettyGCodeApp) {
  const $dashboard = $('#tab_plugin_dashboard')
  if (!$dashboard.length) return

  const dashboardOverlay: Overlay = {
    measure () {
      const rect = $dashboard[0].getBoundingClientRect()
      return { driver: rect.height, width: rect.width, height: rect.height }
    },
    apply: setDashboardHeight,
    persist () {
      app.settings.dashboardHeight = Math.round($dashboard[0].getBoundingClientRect().height)
      app.settings.save()
    }
  }

  $dashboard.append('<div class="pg-resize-handle pg-resize-top"></div><div class="pg-resize-handle pg-resize-right"></div>')
  makeResizable($dashboard.children('.pg-resize-top'), dashboardOverlay, 'y', -1)
  makeResizable($dashboard.children('.pg-resize-right'), dashboardOverlay, 'x', 1)

  // The dashboard fills in asynchronously after startup: keep the height in step with its content
  const contentObserver = new ResizeObserver(() => { if (dashboardHeight) setDashboardHeight(dashboardHeight) })
  contentObserver.observe($dashboard[0])
}
