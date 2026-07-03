import { Settings } from './settings.js'
import { Viewer } from './viewer.js'
import { parseGcodeFile } from './gcode/parser.js'
import { PrintTimeline } from './gcode/print-timeline.js'
import { GCodeModel } from './gcode/gcode-model.js'
import { initSettingsPanel } from './ui/settings-panel.js'
import { initOverlayWindows, updateWindowStates } from './ui/overlay-windows.js'
import { updateWebcamStream } from './ui/webcam.js'
import { initLayerSlider, setLayerSliderMax, setLayerSliderValue } from './ui/layer-slider.js'
import { initToggleButtons } from './ui/toggle-buttons.js'
import { setStatusBarText } from './ui/status-bar.js'

const PG_TAB = '#tab_plugin_prettygcode'

export class PrettyGCodeApp {
  constructor ({ settingsVM, printerProfilesVM }) {
    // ViewModel bindings
    this.settingsVM = settingsVM
    this.printerProfilesVM = printerProfilesVM

    // Plugin frontend settings
    this.settings = new Settings()
    this.settings.load()

    // Plugin view gets lazy-initialized when the tab is opened the first time
    this.viewInitialized = false

    // 3D view components
    this.viewer = new Viewer(this)
    this.printTimeline = new PrintTimeline()
    this.gcodeModel = new GCodeModel(this.settings, this.printTimeline, this.viewer.mirrorBoundsPlanes)

    // Parsed gcode of the currently loaded job
    this.parsedGcode = null

    // Print bed geometry
    this.bedVolume = { depth: 0, formFactor: '', height: 0, origin: '', width: 0 }

    // Nozzle diameter from the active printer profile
    this.nozzleDiameter = null

    // Currently loaded job
    this.currentJobPath = ''
    this.currentJobDate = 0

    // Live printer and render state
    this.currentPrinterState = null
    this.currentFilePosition = 0
    this.currentLayerNumber = 0
    this.manualLayerControl = false

    // OctoPrint 2.x changed the terminal log prefixes
    this.recvLogPrefix = parseInt(VERSION, 10) < 2 ? 'Recv: ' : '<<< '
  }

  /* ---- OctoPrint events ---- */

  onTabChange (current, previous) {
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

  fromCurrentData (data) {
    this.updatePrinterData(data)
    if (!this.viewInitialized) return

    // Update status bar with the reported temperatures
    data.logs.forEach((e) => {
      if (e.startsWith(this.recvLogPrefix + 'T:')) {
        setStatusBarText(e.substr(this.recvLogPrefix.length).split('@')[0])
      }
    })
  }

  fromHistoryData (data) {
    this.updatePrinterData(data)
  }

  updatePrinterData (data) {
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

  async loadGcode (jobPath) {
    this.parsedGcode = await parseGcodeFile(jobPath)

    // Index the timeline and build the model
    this.printTimeline.index(this.parsedGcode.layers)
    this.gcodeModel.build(this.parsedGcode.layers)
    this.updateLineWidth()

    // Show the whole model: slider max and current layer at the top
    const layerCount = this.parsedGcode.layers.length
    this.currentLayerNumber = layerCount
    setLayerSliderMax(layerCount)
    if (layerCount) this.viewer.frameBounds()
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
  updatePrintView (deltaSeconds) {
    const state = this.currentPrinterState
    const tracking = state && !this.manualLayerControl && (state.flags.printing || state.flags.paused)

    let needRender = false
    let nozzlePosition = null
    let revealedLayer = null

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

  setCurrentLayerNumber (layerNumber) {
    this.currentLayerNumber = layerNumber
  }

  setManualLayerControl (manual) {
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
