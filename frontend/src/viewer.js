import * as THREE from './three.js'
import CameraControls from 'camera-controls'
import { Vector2, Vector3, Vector4, Quaternion, Matrix4, Spherical, Box3, Sphere, Raycaster } from 'three'
import { setLayerSliderValue } from './ui/layer-slider.js'

// Copied from camera-controls/readme.md's `subsetOfTHREE` to keep three.js tree-shakeable
const CAMERA_CONTROLS_THREE = { Vector2, Vector3, Vector4, Quaternion, Matrix4, Spherical, Box3, Sphere, Raycaster }

// Themes
const LIGHT_BACKGROUND = 0xd0d0d0
const DARK_BACKGROUND = 0x000000

// Seconds the camera must sit idle before it starts auto-orbiting
const ORBIT_IDLE_DELAY = 5

// Nozzle model
const NOZZLE_URL = PLUGIN_BASEURL + 'prettygcode/static/js/models/ExtruderNozzle.obj'

// Planes used to clip the gcode reflection when the camera is below the bed
const BELOW_BED_CLIP_PLANES = [new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)]
const NO_CLIP_PLANES = []

export class Viewer {
  // Renderer
  renderer = null
  forceRender = true
  timer = null

  // Scene
  scene = null

  // Camera
  camera = null
  cameraControls = null
  cameraIdleTime = 0

  // Camera to render metallic reflections on the nozzle
  reflectionCamera = null

  // Lights
  underBedLight = null
  cameraLight = null

  // Nozzle model
  nozzleModel = null

  // Bound the gcode reflection to the bed surface: 4 planes through the camera and the bed
  // edges, so a reflected point is shown only where the line of sight crosses the bed.
  // Updated each frame and applied to the mirror material only (see GCodeParser).
  mirrorBoundsPlanes = [new THREE.Plane(), new THREE.Plane(), new THREE.Plane(), new THREE.Plane()]

  /* ---- Setup ---- */

  constructor (app) {
    this.app = app
  }

  init () {
    const settings = this.app.settings
    const bedVolume = this.app.bedVolume
    const canvas = document.getElementById('pg-canvas')

    // Renderer
    THREE.ColorManagement.enabled = false
    this.createRenderer(canvas, settings.antialias)

    // Camera and controls
    this.camera = new THREE.PerspectiveCamera(70, 2, 0.1, 10000)
    this.camera.up.set(0, 0, 1)
    this.camera.position.set(bedVolume.width, 0, 50)
    CameraControls.install({ THREE: CAMERA_CONTROLS_THREE })
    this.cameraControls = new CameraControls(this.camera, canvas)
    this.cameraControls.dollyToCursor = true
    this.resetCamera()

    // Scene
    this.scene = new THREE.Scene()
    this.applyBackground(settings.darkMode)

    // Bed (grid)
    this.updateGridMesh()

    // Under bed light
    this.underBedLight = new THREE.PointLight(0xffffff)
    this.underBedLight.decay = 0
    this.underBedLight.position.set(0, 0, -bedVolume.height)
    this.scene.add(this.underBedLight)

    // Camera light
    this.cameraLight = new THREE.PointLight(0xffffff)
    this.cameraLight.decay = 0
    this.cameraLight.position.copy(this.camera.position)
    this.scene.add(this.cameraLight)

    // Reflection camera
    this.reflectionCamera = new THREE.CubeCamera(1, 100000, new THREE.WebGLCubeRenderTarget(128))
    this.reflectionCamera.position.set(bedVolume.width / 2, bedVolume.depth / 2, 10)
    this.scene.add(this.reflectionCamera)

    this.timer = new THREE.Timer()
    this.animate()
  }

  createRenderer (canvas, antialias) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias })
    this.renderer.setPixelRatio(window.devicePixelRatio)
    this.renderer.localClippingEnabled = true // Needed for the gcode reflection on the bed surface
  }

  loadNozzle () {
    new THREE.OBJLoader().load(NOZZLE_URL, (obj) => {
      obj.rotation.x = Math.PI / 2
      obj.scale.setScalar(0.1)
      obj.position.set(0, 0, 10)
      const material = new THREE.MeshStandardMaterial({
        metalness: 1,
        roughness: 0.5,
        envMap: this.reflectionCamera.renderTarget.texture,
        color: 0xba971b
      })
      obj.children.forEach((child) => {
        if (child instanceof THREE.Mesh) child.material = material
      })
      this.nozzleModel = obj
      this.scene.add(obj)
      this.requestRender()
    })
  }

  /* ---- Render loop ---- */

  animate () {
    const app = this.app
    const settings = app.settings

    this.timer.update()
    const delta = this.timer.getDelta()

    let needRender = this.forceRender
    this.forceRender = false

    // Rebuild the nozzle reflection (only on a forced render)
    if (needRender) this.reflectionCamera.update(this.renderer, this.scene)

    // Drain buffered moves to advance the nozzle animation
    if (app.printHeadSimulator) app.printHeadSimulator.updatePosition(delta)

    // Track the live print, otherwise follow the manually selected layer
    const trackingLivePrint = app.currentPrinterState && !app.manualLayerControl &&
            (app.currentPrinterState.flags.printing || app.currentPrinterState.flags.paused)
    if (trackingLivePrint) {
      // Nozzle follows the simulated print head, or parks at origin until its position is known
      if (this.nozzleModel && app.printHeadSimulator) {
        const headPosition = app.printHeadSimulator.getCurrentPosition()
        if (headPosition) {
          this.nozzleModel.position.copy(headPosition)
          needRender = true
        } else if (this.nozzleModel.position.lengthSq()) {
          this.nozzleModel.position.set(0, 0, 0)
          needRender = true
        }
      }
      // Reveal gcode up to the live file position
      if (app.gcodeParser) {
        const calculatedLayer = app.gcodeParser.syncGcodeObjToFilePos(app.currentFilePosition)
        app.gcodeParser.highlightLayer(calculatedLayer)
        setLayerSliderValue(calculatedLayer)
        needRender = true
      }
    } else {
      // Park the nozzle at the origin
      if (this.nozzleModel && this.nozzleModel.position.lengthSq()) {
        this.nozzleModel.position.set(0, 0, 0)
        needRender = true
      }
      // Reveal gcode up to the selected layer
      if (app.gcodeParser && app.gcodeParser.syncGcodeObjToLayer(app.currentLayerNumber)) {
        app.gcodeParser.highlightLayer(app.currentLayerNumber)
        needRender = true
      }
    }

    // Show or hide the nozzle to match the setting
    if (this.nozzleModel && this.nozzleModel.visible !== settings.showNozzle) {
      this.nozzleModel.visible = settings.showNozzle
      needRender = true
    }

    // Auto-orbit once the camera has sat idle a while
    if (this.cameraControls.update(delta)) {
      this.cameraIdleTime = 0
      needRender = true
    } else {
      this.cameraIdleTime += delta
      if (settings.orbitWhenIdle && this.cameraIdleTime > ORBIT_IDLE_DELAY) {
        this.cameraControls.rotate(delta / 5.0, 0, false)
        this.cameraControls.update(delta)
        needRender = true
      }
    }

    // Light follows the camera
    this.cameraLight.position.copy(this.camera.position)

    // Match the canvas to its display size, re-rendering if it changed
    if (this.resizeCanvasToDisplaySize()) needRender = true

    // Keep the bed mirror clipped: refresh its bounds, and cull it when viewing from below the bed
    if (needRender && settings.showMirror) this.updateMirrorBoundsPlanes()
    this.renderer.clippingPlanes = (settings.showMirror && this.camera.position.z < 0) ? BELOW_BED_CLIP_PLANES : NO_CLIP_PLANES

    // Render only when something changed this frame
    if (needRender) this.renderer.render(this.scene, this.camera)

    // Schedule the next frame
    requestAnimationFrame(() => this.animate())
  }

  requestRender () {
    // Force a render on the next animation frame
    this.forceRender = true
  }

  resizeCanvasToDisplaySize () {
    const canvas = this.renderer.domElement
    const width = canvas.clientWidth
    const height = canvas.clientHeight

    // Skip if already at the display size
    const current = this.renderer.getSize(new Vector2())
    if (current.width === width && current.height === height) return false

    // Resize canvas
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.cameraControls.setViewport(0, 0, width, height)
    return true
  }

  /* ---- Scene and camera ---- */

  updateGridMesh () {
    if (!this.scene) return

    const bedVolume = this.app.bedVolume

    // Drop the previous bed before rebuilding it at the current size
    for (const name of ['plane', 'grid']) {
      const existing = this.scene.getObjectByName(name)
      if (existing) this.scene.remove(existing)
    }

    // With a lower-left origin the bed spans [0..size], so center it on the world origin
    const lowerleft = bedVolume.origin === 'lowerleft'
    const centerX = lowerleft ? bedVolume.width / 2 : 0
    const centerY = lowerleft ? bedVolume.depth / 2 : 0

    // Translucent bed surface, dropped just below the grid to avoid z-fighting
    const planeMaterial = new THREE.MeshBasicMaterial({ color: 0x909090, side: THREE.DoubleSide, transparent: true, opacity: 0.2 })
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(bedVolume.width, bedVolume.depth), planeMaterial)
    plane.name = 'plane'
    plane.position.set(centerX, centerY, -0.1)
    this.scene.add(plane)

    // Grid lines, rotated from three's default XZ plane into the scene's z-up XY plane
    const grid = new THREE.GridHelper(bedVolume.width, bedVolume.width / 10, 0x000000, 0x888888)
    grid.name = 'grid'
    grid.position.set(centerX, centerY, 0)
    grid.material.transparent = true
    grid.material.opacity = 0.6
    grid.quaternion.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0))
    this.scene.add(grid)
  }

  resetCamera (enableTransition = false) {
    if (!this.cameraControls) return

    const bedVolume = this.app.bedVolume
    const lowerleft = bedVolume.origin === 'lowerleft'

    // Aim at the bed center
    const targetX = lowerleft ? bedVolume.width / 2 : 0
    const targetY = lowerleft ? bedVolume.depth / 2 : 0

    this.cameraControls.setTarget(targetX, targetY, 0, enableTransition)
  }

  frameBounds () {
    // Re-center on the bed first
    this.resetCamera(true)

    // Pull back to roughly the print's footprint, with a floor for tiny models
    const size = this.app.gcodeParser.bounds.getSize(new THREE.Vector3())
    this.cameraControls.dollyTo(Math.max(40, size.x, size.y), true)
  }

  updateMirrorBoundsPlanes () {
    const bedVolume = this.app.bedVolume
    const lowerleft = bedVolume.origin === 'lowerleft'
    const xMin = lowerleft ? 0 : -bedVolume.width / 2
    const xMax = lowerleft ? bedVolume.width : bedVolume.width / 2
    const yMin = lowerleft ? 0 : -bedVolume.depth / 2
    const yMax = lowerleft ? bedVolume.depth : bedVolume.depth / 2

    const corners = [
      new Vector3(xMin, yMin, 0),
      new Vector3(xMax, yMin, 0),
      new Vector3(xMax, yMax, 0),
      new Vector3(xMin, yMax, 0)
    ]
    const center = new Vector3((xMin + xMax) / 2, (yMin + yMax) / 2, 0)
    const cameraPosition = this.camera.position

    // Each plane passes through the camera and one bed edge; orient it so the bed
    // interior (and the reflection over it) stays in the kept half-space
    for (let i = 0; i < 4; i++) {
      const plane = this.mirrorBoundsPlanes[i]
      plane.setFromCoplanarPoints(cameraPosition, corners[i], corners[(i + 1) % 4])
      if (plane.distanceToPoint(center) < 0) plane.negate()
    }
  }

  /* ---- Apply settings ---- */

  applyBackground (darkMode) {
    this.scene.background = new THREE.Color(darkMode ? DARK_BACKGROUND : LIGHT_BACKGROUND)
    this.requestRender()
  }

  applyAntialias (antialias) {
    // Antialias is a fixed WebGL context attribute, so toggling it means recreating the
    // context. A context stays bound to its canvas, so swap in a fresh canvas too.
    const oldCanvas = this.renderer.domElement
    const canvas = oldCanvas.cloneNode(false)

    oldCanvas.replaceWith(canvas)

    this.cameraControls.disconnect()
    this.renderer.dispose()

    this.createRenderer(canvas, antialias)
    this.cameraControls.connect(canvas)

    this.requestRender()
  }
}
