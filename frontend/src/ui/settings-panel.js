import GUI from 'lil-gui'
import { applyStatusBarVisibility } from './status-bar.js'

export function initSettingsPanel (app) {
  const settings = app.settings
  const gui = new GUI({ autoPlace: false, title: 'View Options' })
  $('#pg-view-settings').append(gui.domElement)
  gui.onChange(() => settings.save())

  const option = (prop, name, help) => {
    const controller = gui.add(settings, prop).name(name)
    controller.domElement.title = help
    return controller
  }

  option(
    'darkMode',
    'Dark mode',
    'Use a dark background for the 3D view.'
  ).onFinishChange(() => app.viewer.applyBackground(settings.darkMode))

  option(
    'showMirror',
    'Mirror',
    'Show a reflection of the print on the bed.'
  ).onFinishChange(() => app.gcodeParser.rebuildObject())

  option(
    'orbitWhenIdle',
    'Orbit when idle',
    'After 5 seconds with no mouse/camera movement the camera slowly orbits around the center.'
  )

  option(
    'thickLines',
    'Thick lines',
    'Display lines with thickness, based on nozzle size.'
  ).onFinishChange(() => app.gcodeParser.rebuildObject())

  option(
    'antialias',
    'Antialiasing',
    'Smooth jagged edges in the 3D view.'
  ).onFinishChange(() => app.viewer.applyAntialias(settings.antialias))

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
