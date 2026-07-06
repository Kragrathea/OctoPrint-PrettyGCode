import { Settings } from './settings'
import { Viewer } from './viewer'
import { parseGcodeFile, GCodeParser } from './gcode/parser'
import { PrintTimeline } from './gcode/print-timeline'
import { GCodeModel } from './gcode/gcode-model'
import { initSettingsPanel } from './ui/settings-panel'
import { initOverlayWindows, updateWindowStates } from './ui/overlay-windows'
import { updateWebcamStream } from './ui/webcam'
import { initLayerSlider, setLayerSliderMax, setLayerSliderValue } from './ui/layer-slider'
import { initToggleButtons } from './ui/toggle-buttons'
import { setStatusBarText } from './ui/status-bar'
import type { Vector3 } from 'three'

/** Print bed geometry */
interface BedVolume {
  depth: number
  formFactor: string
  height: number
  origin: string
  width: number
}

/** Printer state reported by OctoPrint */
interface PrinterState {
  flags: { printing: boolean, paused: boolean }
}

/** OctoPrint current/history data payload */
interface PrinterDataPayload {
  logs: string[]
  job: { file: { path: string, date: number } }
  state: PrinterState
  progress: { filepos: number }
}

/** Selector of the plugin tab */
const PG_TAB = '#tab_plugin_prettygcode'

/** Main plugin container, orchestrating all its components */
export class PrettyGCodeApp {
  /** OctoPrint settings view model */
  settingsVM: any
  /** OctoPrint printer profiles view model */
  printerProfilesVM: any

  /** Plugin frontend settings */
  settings = new Settings()

  /** Whether the plugin view has been initialized */
  viewInitialized = false

  /** The 3D view */
  viewer = new Viewer(this)
  /** Print timeline of the loaded gcode */
  printTimeline = new PrintTimeline()
  /** The rendered gcode model */
  gcodeModel = new GCodeModel(this.settings, this.printTimeline, this.viewer.mirrorBoundsPlanes)

  /** Parsed gcode of the currently loaded job */
  parsedGcode: GCodeParser | null = null

  /** Print bed geometry */
  bedVolume: BedVolume = { depth: 0, formFactor: '', height: 0, origin: '', width: 0 }

  /** Nozzle diameter from the active printer profile */
  nozzleDiameter: number | null = null

  /** Server path of the currently loaded job */
  currentJobPath = ''
  /** Upload date of the currently loaded job */
  currentJobDate = 0

  /** Latest printer state reported by OctoPrint */
  currentPrinterState: PrinterState | null = null
  /** Bytes of the job file sent to the printer so far */
  currentFilePosition = 0
  /** 1-based topmost layer to display */
  currentLayerNumber = 0
  /** Whether the user is browsing layers manually */
  manualLayerControl = false

  /** Prefix of received terminal log lines */
  recvLogPrefix = parseInt(VERSION, 10) < 2 ? 'Recv: ' : '<<< '

  /**
   * @param viewModels - OctoPrint view models
   */
  constructor ({ settingsVM, printerProfilesVM }: { settingsVM: any, printerProfilesVM: any }) {
    this.settingsVM = settingsVM
    this.printerProfilesVM = printerProfilesVM
    this.settings.load()
  }

  /* ---- OctoPrint events ---- */

  /**
   * Reacts to an OctoPrint tab switch, bringing the view up to date
   * @param current - Selector of the now selected tab
   * @param previous - Selector of the previously selected tab
   */
  onTabChange (current: string, previous: string) {
    if (current === PG_TAB) {
      if (!this.viewInitialized) {
        // Bed geometry and nozzle size, kept in sync with the active printer profile
        this.updateBedVolume()
        this.updateNozzleDiameter()
        this.printerProfilesVM.currentProfileData.subscribe(() => {
          this.updateBedVolume()
          this.updateNozzleDiameter()
          this.updateLineWidth()
          this.viewer.updateBedMesh()
          this.viewer.resetCameraTarget()
        })

        // 3D view and gcode
        this.viewer.init()
        this.viewer.loadNozzle()
        this.viewer.scene.add(this.gcodeModel.linesGroup)
        this.loadGcode(this.currentJobPath)

        // UI controls
        initSettingsPanel(this)
        initLayerSlider(this)
        initOverlayWindows(this)
        initToggleButtons(this)
        updateWindowStates(this)

        // Set view as initialized
        this.viewInitialized = true
      }
      updateWebcamStream(this)
    } else if (previous === PG_TAB) {
      updateWebcamStream(this)
    }
  }

  /**
   * Feeds the app OctoPrint's live printer data
   * @param data - OctoPrint current data payload
   */
  fromCurrentData (data: PrinterDataPayload) {
    this.updatePrinterData(data)
    if (!this.viewInitialized) return

    // Update status bar with the reported temperatures
    data.logs.forEach((e) => {
      if (e.startsWith(this.recvLogPrefix + 'T:')) {
        setStatusBarText(e.substr(this.recvLogPrefix.length).split('@')[0])
      }
    })
  }

  /**
   * Feeds the app the printer data OctoPrint sends on connect
   * @param data - OctoPrint history data payload
   */
  fromHistoryData (data: PrinterDataPayload) {
    this.updatePrinterData(data)
  }

  /**
   * Syncs the app with a printer data payload, loading the newly selected job if it changed
   * @param data - OctoPrint data payload
   */
  updatePrinterData (data: PrinterDataPayload) {
    // On a newly selected file, reload the gcode
    const job = data.job
    if (this.currentJobPath !== job.file.path || this.currentJobDate !== job.file.date) {
      this.currentJobPath = job.file.path
      this.currentJobDate = job.file.date
      if (this.viewInitialized) this.loadGcode(this.currentJobPath)
    }

    // Live printer state and progress
    this.currentPrinterState = data.state
    this.currentFilePosition = data.progress.filepos
  }

  /* ---- Gcode loading ---- */

  /**
   * Loads a job file and displays it in the 3D view
   * @param jobPath - Server path of the job file
   */
  async loadGcode (jobPath: string) {
    this.parsedGcode = await parseGcodeFile(jobPath)

    // Index the timeline and build the model
    this.printTimeline.index(this.parsedGcode.layers)
    this.gcodeModel.build(this.parsedGcode.layers)
    this.updateLineWidth()

    // Show the whole model: slider max and current layer at the top
    const layerCount = this.parsedGcode.layers.length
    this.currentLayerNumber = layerCount
    setLayerSliderMax(layerCount)
    if (layerCount) this.viewer.frameBounds(this.parsedGcode.bounds)
    this.viewer.requestRender()
  }

  /** Updates the drawn line thickness to the current nozzle diameter */
  updateLineWidth () {
    // The slicer's nozzle diameter wins over the printer profile
    this.gcodeModel.applyLineWidth(this.parsedGcode?.slicerNozzleDiameter ?? this.nozzleDiameter)
    this.viewer.requestRender()
  }

  /* ---- Print tracking ---- */

  /**
   * Advances the displayed print progress for a new frame
   * @param deltaSeconds - Seconds elapsed since the previous call
   * @returns Whether the scene changed and the nozzle position to show, if any
   */
  updatePrintView (deltaSeconds: number) {
    const state = this.currentPrinterState
    const tracking = state && !this.manualLayerControl && (state.flags.printing || state.flags.paused)

    let needRender = false
    let nozzlePosition: Vector3 | null = null
    let revealedLayer: number | null = null

    if (tracking) {
      // Reveal gcode up to where the nozzle has passed
      const spot = this.printTimeline.advance(this.currentFilePosition, deltaSeconds)
      if (spot) {
        this.gcodeModel.revealTo(spot)
        revealedLayer = this.printTimeline.layerNumberAt(spot.segmentIndex)
        setLayerSliderValue(revealedLayer)
      }
      needRender = true
      nozzlePosition = this.printTimeline.getNozzlePosition()
    } else {
      // Reveal gcode up to the selected layer
      needRender = this.gcodeModel.syncToLayer(this.currentLayerNumber)
      if (needRender) revealedLayer = this.currentLayerNumber
    }

    // Highlight the revealed layer
    if (revealedLayer != null) this.gcodeModel.highlightLayer(revealedLayer)

    return { needRender, nozzlePosition }
  }

  /* ---- UI events ---- */

  /**
   * Selects the topmost layer to display
   * @param layerNumber - 1-based layer number
   */
  setCurrentLayerNumber (layerNumber: number) {
    this.currentLayerNumber = layerNumber
  }

  /**
   * Turns manual layer browsing on or off
   * @param manual - True to enable manual layer browsing
   */
  setManualLayerControl (manual: boolean) {
    this.manualLayerControl = manual
  }

  /** (Re)applies the dark mode setting to the 3D view */
  updateDarkMode () {
    this.viewer.applyBackground(this.settings.darkMode)
  }

  /** (Re)applies the antialias setting to the 3D view */
  updateAntialias () {
    this.viewer.applyAntialias(this.settings.antialias)
  }

  /** (Re)applies the layer highlight setting to the displayed layer */
  updateLayerHighlight () {
    this.gcodeModel.highlightLayer(this.currentLayerNumber)
    this.viewer.requestRender()
  }

  /** Rebuilds the displayed gcode model to reflect the current settings */
  rebuildGcodeModel () {
    this.gcodeModel.rebuild()
    this.viewer.requestRender()
  }

  /* ---- Printer profile ---- */

  /** Refreshes the nozzle diameter from the active printer profile */
  updateNozzleDiameter () {
    const currentProfileData = this.printerProfilesVM.currentProfileData()
    const extruder = currentProfileData && currentProfileData.extruder
    this.nozzleDiameter = extruder && typeof extruder.nozzleDiameter === 'function' ? extruder.nozzleDiameter() : null
  }

  /** Refreshes the print bed geometry from the active printer profile */
  updateBedVolume () {
    const currentProfileData = this.printerProfilesVM.currentProfileData()
    if (!currentProfileData || !currentProfileData.volume) return

    const volume = currentProfileData.volume

    const dims = typeof volume.custom_box === 'function'
      ? { width: volume.width(), height: volume.height(), depth: volume.depth() }
      : {
          width: volume.custom_box.x_max() - volume.custom_box.x_min(),
          height: volume.custom_box.z_max() - volume.custom_box.z_min(),
          depth: volume.custom_box.y_max() - volume.custom_box.y_min()
        }

    this.bedVolume = { ...dims, origin: volume.origin(), formFactor: volume.formFactor() }
  }
}
