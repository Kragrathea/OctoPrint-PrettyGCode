import { Settings } from './settings.js'
import { Viewer } from './viewer.js'
import { GCodeParser } from './gcode/parsing.js'
import { PrintHeadSimulator } from './gcode/print-head-simulation.js'
import { initSettingsPanel } from './ui/settings-panel.js'
import { initOverlayWindows, updateWindowStates } from './ui/overlay-windows.js'
import { updateWebcamStream } from './ui/webcam.js'
import { initLayerSlider, setLayerSliderMax } from './ui/layer-slider.js'
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
    this.gcodeParser = new GCodeParser(this)
    this.printHeadSimulator = new PrintHeadSimulator()

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
    const isOctoPrint1 = parseInt(VERSION, 10) < 2
    this.sendLogPrefix = isOctoPrint1 ? 'Send: ' : '>>>'
    this.recvLogPrefix = isOctoPrint1 ? 'Recv: ' : '<<< '
  }

  onTabChange (current, previous) {
    if (current === PG_TAB) {
      if (!this.viewInitialized) {
        // Bed geometry and nozzle size, kept in sync with the active printer profile
        this.updateBedVolume()
        this.updateNozzleDiameter()
        this.printerProfilesVM.currentProfileData.subscribe(() => {
          this.updateBedVolume()
          this.updateNozzleDiameter()
          this.gcodeParser.applyLineWidth()
          this.viewer.updateGridMesh()
          this.viewer.resetCamera()
        })

        // 3D view and gcode
        this.viewer.init()
        this.viewer.loadNozzle()
        this.viewer.scene.add(this.gcodeParser.getObject())
        this.gcodeParser.loadGcode(this.currentJobPath)

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
    this.updateData(data)
    if (!this.viewInitialized) return

    // Seed the nozzle's Z after a mid-print reload
    this.printHeadSimulator.seedZ(data.currentZ)

    data.logs.forEach((e) => {
      if (e.startsWith(this.sendLogPrefix)) {
        // Update nozzle simulation
        this.printHeadSimulator.addCommand(e)
      } else if (e.startsWith(this.recvLogPrefix + 'T:')) {
        // Update status bar
        setStatusBarText(e.substr(this.recvLogPrefix.length).split('@')[0])
      }
    })
  }

  fromHistoryData (data) {
    this.updateData(data)
  }

  updateData (data) {
    // On a newly selected file, reload the gcode and start a fresh nozzle simulation
    const job = data.job
    if (this.currentJobPath !== job.file.path || this.currentJobDate !== job.file.date) {
      this.currentJobPath = job.file.path
      this.currentJobDate = job.file.date
      if (this.viewInitialized) {
        this.gcodeParser.loadGcode(this.currentJobPath)
        this.printHeadSimulator = new PrintHeadSimulator()
      }
    }

    // When a print ends (the printer was active and now isn't) drop the moves still queued in the nozzle simulation.
    const wasPrinting = this.currentPrinterState && (this.currentPrinterState.flags.printing || this.currentPrinterState.flags.paused)
    const isPrinting = data.state.flags.printing || data.state.flags.paused
    if (wasPrinting && !isPrinting) {
      this.printHeadSimulator = new PrintHeadSimulator()
    }

    // Live printer state and progress
    this.currentPrinterState = data.state
    this.currentFilePosition = data.progress.filepos
  }

  onGcodeLoaded (layerCount) {
    // After a (re)load show the whole model: slider max and current layer at the top
    this.currentLayerNumber = layerCount
    setLayerSliderMax(layerCount)
    if (layerCount) this.viewer.frameBounds()
    this.viewer.requestRender()
  }

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
