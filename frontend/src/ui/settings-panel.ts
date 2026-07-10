import GUI from 'lil-gui'
import { applyStatusBarVisibility } from './status-bar'
import { NAVIGATION_MODES } from '../viewer'
import type { Settings } from '../settings'
import type { PrettyGCodeApp } from '../app'

/**
 * Builds the plugin settings panel
 * @param app - Application instance
 * @returns The created panel
 */
export function initSettingsPanel (app: PrettyGCodeApp) {
  const settings = app.settings
  const gui = new GUI({ autoPlace: false, title: 'View Options' })
  $('#pg-view-settings').append(gui.domElement)
  gui.onChange(() => settings.save())

  const option = (prop: keyof Settings, name: string, help: string) => {
    const controller = gui.add(settings, prop).name(name)
    controller.domElement.title = help
    return controller
  }

  const navigationOptions = Object.fromEntries(Object.entries(NAVIGATION_MODES).map(([key, mode]) => [mode.name, key]))
  const navigation = gui.add(settings, 'navigationMode', navigationOptions).name('Navigation')
  navigation.domElement.title = 'Set which mouse buttons rotate, pan and zoom the 3D view.'
  navigation.onFinishChange(() => app.updateNavigationMode())

  option(
    'darkMode',
    'Dark mode',
    'Use a dark background for the 3D view.'
  ).onFinishChange(() => app.updateDarkMode())

  option(
    'showMirror',
    'Mirror',
    'Show a reflection of the print on the bed.'
  ).onFinishChange(() => app.rebuildGcodeModel())

  option(
    'orbitWhenIdle',
    'Orbit when idle',
    'After 5 seconds with no mouse/camera movement the camera slowly orbits around the center.'
  )

  option(
    'thickLines',
    'Thick lines',
    'Display lines with thickness, based on nozzle size.'
  ).onFinishChange(() => app.rebuildGcodeModel())

  option(
    'highlightLayer',
    'Highlight layer',
    'Shade the topmost displayed layer gray to make it stand out. Only works with thick lines.'
  ).onFinishChange(() => app.updateLayerHighlight())

  option(
    'antialias',
    'Antialiasing',
    'Smooth jagged edges in the 3D view.'
  ).onFinishChange(() => app.updateAntialias())

  option(
    'showNozzle',
    'Show nozzle',
    'Show a 3D model of the nozzle at the position currently being sent to the printer.'
  )

  option(
    'showStatusBar',
    'Status bar',
    'Show the temperature status bar across the top of the view.'
  ).onFinishChange(() => applyStatusBarVisibility(settings.showStatusBar))

  return gui
}
