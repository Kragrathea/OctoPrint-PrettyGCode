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

// Print bed geometry
interface BedVolume {
  depth: number
  formFactor: string
  height: number
  origin: string
  width: number
}

// OctoPrint current/history data payloads
interface PrinterState {
  flags: { printing: boolean, paused: boolean }
}
interface PrinterDataPayload {
  logs: string[]
  job: { file: { path: string, date: number } }
  state: PrinterState
  progress: { filepos: number }
}

const PG_TAB = '#tab_plugin_prettygcode'

export class PrettyGCodeApp {
  // ViewModel bindings
  settingsVM: any
  printerProfilesVM: any

  // Plugin frontend settings
  settings = new Settings()

  // Plugin view gets lazy-initialized when the tab is opened the first time
  viewInitialized = false

  // 3D view components
  viewer = new Viewer(this)
  printTimeline = new PrintTimeline()
  gcodeModel = new GCodeModel(this.settings, this.printTimeline, this.viewer.mirrorBoundsPlanes)

  // Parsed gcode of the currently loaded job
  parsedGcode: GCodeParser | null = null

  // Print bed geometry
  bedVolume: BedVolume = { depth: 0, formFactor: '', height: 0, origin: '', width: 0 }

  // Nozzle diameter from the active printer profile
  nozzleDiameter: number | null = null

  // Currently loaded job
  currentJobPath = ''
  currentJobDate = 0

  // Live printer and render state
  currentPrinterState: PrinterState | null = null
  currentFilePosition = 0
  currentLayerNumber = 0
  manualLayerControl = false

  // OctoPrint 2.x changed the terminal log prefixes
  recvLogPrefix = parseInt(VERSION, 10) < 2 ? 'Recv: ' : '<<< '

  constructor ({ settingsVM, printerProfilesVM }: { settingsVM: any, printerProfilesVM: any }) {
    this.settingsVM = settingsVM
    this.printerProfilesVM = printerProfilesVM
    this.settings.load()
  }

  /* ---- OctoPrint events ---- */

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

  fromHistoryData (data: PrinterDataPayload) {
    this.updatePrinterData(data)
  }

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

  updateLineWidth () {
    // The slicer's nozzle diameter wins over the printer profile
    this.gcodeModel.applyLineWidth(this.parsedGcode?.slicerNozzleDiameter ?? this.nozzleDiameter)
    this.viewer.requestRender()
  }

  /* ---- Print tracking ---- */

  // Reveal the gcode up to the live print position, or up to the manually selected layer.
  // Returns whether the scene changed and the nozzle position.
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

  setCurrentLayerNumber (layerNumber: number) {
    this.currentLayerNumber = layerNumber
  }

  setManualLayerControl (manual: boolean) {
    this.manualLayerControl = manual
  }

  updateDarkMode () {
    this.viewer.applyBackground(this.settings.darkMode)
  }

  updateAntialias () {
    this.viewer.applyAntialias(this.settings.antialias)
  }

  rebuildGcodeModel () {
    this.gcodeModel.rebuild()
    this.viewer.requestRender()
  }

  /* ---- Printer profile ---- */

  updateNozzleDiameter () {
    const currentProfileData = this.printerProfilesVM.currentProfileData()
    const extruder = currentProfileData && currentProfileData.extruder
    this.nozzleDiameter = extruder && typeof extruder.nozzleDiameter === 'function' ? extruder.nozzleDiameter() : null
  }

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
