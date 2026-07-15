import { Settings } from './settings'
import { Viewer } from './viewer'
import { parseGcodeFile, GCodeParser } from './gcode/parser'
import { PrintTimeline } from './gcode/print-timeline'
import { PrintExclusions } from './gcode/exclusions'
import { GCodeModel } from './gcode/gcode-model'
import { initSettingsPanel } from './ui/settings-panel'
import { initOverlayWindows } from './ui/overlay-windows'
import { updateDashboardOverlay } from './ui/dashboard'
import { updateWebcamOverlay } from './ui/webcam'
import { initLayerSlider, updateLayerSliderMax, setLayerSliderValue } from './ui/layer-slider'
import { initToggleButtons } from './ui/toggle-buttons'
import { setStatusBarText, applyStatusBarVisibility } from './ui/status-bar'
import type { BedVolume, PrintViewUpdate } from './viewer'
import type { Vector3 } from 'three'

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
  /** OctoPrint printer profiles view model */
  private readonly printerProfilesVM: any
  /** OctoPrint settings view model */
  private readonly settingsVM: any

  /** Plugin frontend settings */
  readonly settings = new Settings()

  /** Whether the plugin view has been initialized */
  private viewInitialized = false

  /** The 3D view */
  private readonly viewer = new Viewer(this.settings, () => this.bedVolume, (deltaSeconds) => this.updatePrintView(deltaSeconds))
  /** Print exclusions of the loaded gcode */
  private readonly exclusions = new PrintExclusions()
  /** Print timeline of the loaded gcode */
  private readonly printTimeline = new PrintTimeline(this.exclusions)
  /** The rendered gcode model */
  private readonly gcodeModel = new GCodeModel(this.settings, this.printTimeline, this.exclusions, this.viewer.mirrorBoundsPlanes)

  /** Parsed gcode of the currently loaded job */
  private parsedGcode: GCodeParser | null = null

  /** Print bed geometry */
  private bedVolume: BedVolume = { depth: 0, height: 0, origin: '', width: 0 }

  /** Nozzle diameter from the active printer profile */
  private nozzleDiameter: number | null = null

  /** Server path of the currently loaded job */
  private currentJobPath = ''
  /** Upload date of the currently loaded job */
  private currentJobDate = 0

  /** Latest printer state reported by OctoPrint */
  private currentPrinterState: PrinterState | null = null
  /** Bytes of the job file sent to the printer so far */
  private currentFilePosition = 0
  /** 1-based current layer */
  private _currentLayerNumber = 0
  /** Whether the user is browsing layers manually */
  private manualLayerControl = false

  /** Prefix of received terminal log lines */
  private readonly recvLogPrefix = parseInt(VERSION, 10) < 2 ? 'Recv: ' : '<<< '

  /**
   * @param viewModels - OctoPrint view models
   */
  constructor ({ printerProfilesVM, settingsVM }: { printerProfilesVM: any, settingsVM: any }) {
    this.printerProfilesVM = printerProfilesVM
    this.settingsVM = settingsVM
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
        this.viewer.scene.add(this.exclusions.regionMarkersGroup)
        this.loadGcode(this.currentJobPath)
        this.fetchExclusions()

        // UI controls
        initSettingsPanel(this)
        initLayerSlider(this)
        initOverlayWindows(this.settings)
        initToggleButtons(this)
        this.updateDarkMode()

        // Set view as initialized
        this.viewInitialized = true
      }
      this.updateWindowStates()
    } else if (previous === PG_TAB) {
      this.updateWindowStates()
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
   * Handles a plugin message broadcast by the OctoPrint server
   * @param plugin - Identifier of the sending plugin
   * @param data - Message payload
   */
  onDataUpdaterPluginMessage (plugin: string, data: any) {
    if (this.exclusions.applyPluginMessage(plugin, data)) this.updateExclusions()
  }

  /**
   * Syncs the app with a printer data payload, loading the newly selected job if it changed
   * @param data - OctoPrint data payload
   */
  private updatePrinterData (data: PrinterDataPayload) {
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

  /** Layer count of the loaded gcode */
  get layerCount () {
    return this.parsedGcode?.layers.length ?? 0
  }

  /**
   * Loads a job file and displays it in the 3D view
   * @param jobPath - Server path of the job file
   */
  private async loadGcode (jobPath: string) {
    // The object marker tag comes from the Cancel Object plugin settings
    const objectTag = this.settingsVM.settings?.plugins?.cancelobject?.reptag?.()
    this.parsedGcode = await parseGcodeFile(jobPath, objectTag)
    this.exclusions.setGcodeObjectNames(this.parsedGcode.objectNames)

    // Index the timeline and build the model
    this.printTimeline.index(this.parsedGcode.layers)
    this.gcodeModel.build(this.parsedGcode.layers)
    this.updateLineWidth()

    // Show the whole model: slider max and current layer at the top
    updateLayerSliderMax(this)
    this.setCurrentLayerNumber(this.layerCount)
    this.resetView()
    this.viewer.requestRender()
  }

  /** Updates the drawn line thickness to the current nozzle diameter */
  private updateLineWidth () {
    // The slicer's nozzle diameter wins over the printer profile
    this.gcodeModel.applyLineWidth(this.parsedGcode?.slicerNozzleDiameter ?? this.nozzleDiameter)
    this.viewer.requestRender()
  }

  /* ---- Exclusions ---- */

  /** Fetches the current exclusions and applies them to the view */
  private async fetchExclusions () {
    if (await this.exclusions.fetch()) this.updateExclusions()
  }

  /** (Re)applies the current exclusions to the timeline and the model */
  private updateExclusions () {
    if (!this.viewInitialized || !this.parsedGcode) return

    this.printTimeline.index(this.parsedGcode.layers)
    this.gcodeModel.rebuild()
    this.updateLayerHighlight()
  }

  /* ---- Print tracking ---- */

  /**
   * Advances the displayed print progress for a new frame
   * @param deltaSeconds - Seconds elapsed since the previous call
   * @returns Whether the scene changed and the nozzle position to show, if any
   */
  private updatePrintView (deltaSeconds: number): PrintViewUpdate {
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
        this.setCurrentLayerNumber(revealedLayer)
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

  /** 1-based current layer */
  get currentLayerNumber () {
    return this._currentLayerNumber
  }

  /**
   * Selects the current layer
   * @param layerNumber - 1-based layer number
   */
  setCurrentLayerNumber (layerNumber: number) {
    this._currentLayerNumber = layerNumber
    setLayerSliderValue(this, layerNumber)
  }

  /**
   * Turns manual layer browsing on or off
   * @param manual - True to enable manual layer browsing
   */
  setManualLayerControl (manual: boolean) {
    this.manualLayerControl = manual
  }

  /** Resets the camera to the default view */
  resetView () {
    if (this.parsedGcode?.layers.length) this.viewer.frameBounds(this.parsedGcode.bounds)
    else this.viewer.applyDefaultView(true)
  }

  /** (Re)applies the navigation mode setting to the 3D view */
  updateNavigationMode () {
    this.viewer.applyNavigationMode(this.settings.navigationMode)
  }

  /** (Re)applies the dark mode setting */
  updateDarkMode () {
    $('.page-container').toggleClass('pg-dark', this.settings.darkMode)
    this.viewer.applyBackground(this.settings.darkMode)
    this.viewer.updateBedMesh()
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

  /** Shows or hides the overlay windows to match the current settings */
  updateWindowStates () {
    applyStatusBarVisibility(this.settings.showStatusBar)

    $('#state_wrapper').toggleClass('pg-hidden', !this.settings.showState)
    $('#files_wrapper').toggleClass('pg-hidden', !this.settings.showFiles)

    updateDashboardOverlay(this.settings)
    updateWebcamOverlay(this.settings)
  }

  /* ---- Printer profile ---- */

  /** Refreshes the nozzle diameter from the active printer profile */
  private updateNozzleDiameter () {
    const currentProfileData = this.printerProfilesVM.currentProfileData()
    const extruder = currentProfileData && currentProfileData.extruder
    this.nozzleDiameter = extruder && typeof extruder.nozzleDiameter === 'function' ? extruder.nozzleDiameter() : null
  }

  /** Refreshes the print bed geometry from the active printer profile */
  private updateBedVolume () {
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

    this.bedVolume = { ...dims, origin: volume.origin() }
  }
}
