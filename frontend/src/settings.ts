import type { NavigationModeKey } from './viewer'

/** localStorage key holding the settings */
const STORAGE_KEY = 'pg-settings'

/** Plugin frontend settings, persisted in the browser */
export class Settings {
  /** Navigation mode of the 3D view */
  navigationMode: NavigationModeKey = 'prusaslicer'
  /** Whether to use a dark background in the 3D view */
  darkMode = false
  /** Whether to show a reflection of the print on the bed */
  showMirror = false
  /** Whether to auto-orbit the camera when idle */
  orbitWhenIdle = false
  /** Whether to draw the lines with their real thickness */
  thickLines = true
  /** Whether to highlight the topmost displayed layer */
  highlightLayer = true
  /** Whether to antialias the 3D view */
  antialias = true
  /** Transparency of the nozzle model, in percent */
  nozzleTransparency = 0
  /** Whether to reflect the scene on the nozzle model */
  nozzleReflection = true
  /** Whether to show the temperature status bar */
  showStatusBar = true

  /** Whether to show the state side window */
  showState = true
  /** Whether to show the files side window */
  showFiles = false

  /** Whether to show the webcam overlay */
  showWebcam = false
  /** Whether to show the dashboard overlay */
  showDashboard = false

  /** Webcam overlay height in px, 0 for the default */
  webcamHeight = 0
  /** Dashboard overlay height in px, 0 for the default */
  dashboardHeight = 0

  /** Restores the saved settings */
  load () {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
      for (const key in saved) {
        if (key in this) {
          (this as any)[key] = saved[key]
        }
      }
    } catch {}
  }

  /** Persists the current settings */
  save () {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...this }))
    } catch {}
  }
}
