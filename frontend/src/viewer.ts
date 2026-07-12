import * as THREE from './three-exports'
import CameraControls from 'camera-controls'
import { Vector2, Vector3, Vector4, Quaternion, Matrix4, Spherical, Box3, Sphere, Raycaster } from 'three'
import type { Settings } from './settings'

/**
 * Subset of three.js required by camera-controls.
 * Copied from camera-controls/readme.md's `subsetOfTHREE` to keep three.js tree-shakeable
 */
const CAMERA_CONTROLS_THREE = { Vector2, Vector3, Vector4, Quaternion, Matrix4, Spherical, Box3, Sphere, Raycaster }

/** Light theme background color */
const LIGHT_BACKGROUND = 0xd0d0d0
/** Dark theme background color */
const DARK_BACKGROUND = 0x000000

/** Seconds the camera must sit idle before it starts auto-orbiting */
const ORBIT_IDLE_DELAY_SECONDS = 5

/** Mouse buttons usable in a navigation binding */
type MouseButton = 'left' | 'middle' | 'right'
/** Mouse button with an optional modifier key to hold */
type MouseBinding = MouseButton | `${'shift' | 'ctrl'}+${MouseButton}`

/** Mouse bindings of a navigation mode */
interface NavigationMode {
  /** Display name */
  name: string
  /** Bindings that rotate the camera around its target */
  orbit: MouseBinding | MouseBinding[]
  /** Bindings that pan the camera */
  pan: MouseBinding | MouseBinding[]
  /** Bindings that zoom by drag */
  zoom?: MouseBinding | MouseBinding[]
}

/** Navigation modes mirroring popular slicers and CADs */
export const NAVIGATION_MODES = {
  prusaslicer: {
    name: 'PrusaSlicer / Bambu Studio / OrcaSlicer / OpenSCAD',
    orbit: 'left',
    pan: ['right', 'middle']
  },
  cura: {
    name: 'Cura / Tinkercad / Onshape',
    orbit: ['right', 'ctrl+left'],
    pan: ['middle', 'shift+right', 'ctrl+right']
  },
  fusion360: {
    name: 'Fusion 360 / Inventor / AutoCAD',
    orbit: 'shift+middle',
    pan: 'middle'
  },
  blender: {
    name: 'Blender / SketchUp / NX / Creo',
    orbit: 'middle',
    pan: 'shift+middle',
    zoom: 'ctrl+middle'
  },
  solidworks: {
    name: 'SOLIDWORKS',
    orbit: 'middle',
    pan: 'ctrl+middle',
    zoom: 'shift+middle'
  },
  rhino: {
    name: 'Rhinoceros',
    orbit: 'right',
    pan: 'shift+right',
    zoom: 'ctrl+right'
  }
} satisfies Record<string, NavigationMode>

/** Key identifying a navigation mode in NAVIGATION_MODES */
export type NavigationModeKey = keyof typeof NAVIGATION_MODES

/** URL of the nozzle 3D model */
const NOZZLE_MODEL_URL = PLUGIN_BASEURL + 'prettygcode/static/js/models/ExtruderNozzle.obj'
/** Nozzle color */
const NOZZLE_COLOR = 0xba971b
/** Brighter nozzle color compensating for the disabled reflection */
const NOZZLE_UNREFLECTIVE_COLOR = 0xffd826
/** Emissive lift applied to the unreflective nozzle color */
const NOZZLE_UNREFLECTIVE_EMISSIVE = 0.36

/** Planes clipping the gcode reflection when the camera is below the bed */
const BELOW_BED_CLIP_PLANES = [new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)]
/** Empty plane set, to disable clipping */
const NO_CLIP_PLANES: THREE.Plane[] = []

/** Print bed geometry */
export interface BedVolume {
  depth: number
  height: number
  origin: string
  width: number
}

/** Per-frame print view outcome: whether the scene changed and the nozzle position to show */
export interface PrintViewUpdate {
  needRender: boolean
  nozzlePosition: Vector3 | null
}

/** The plugin's 3D view: renders the bed, the gcode model and the nozzle */
export class Viewer {
  /** Plugin frontend settings */
  private readonly settings: Settings
  /** Getter of the current print bed geometry */
  private readonly getBedVolume: () => BedVolume
  /** Callback advancing the print view each frame */
  private readonly onFrame: (deltaSeconds: number) => PrintViewUpdate

  /** WebGL renderer */
  private renderer!: THREE.WebGLRenderer
  /** Whether to render the next frame regardless of changes */
  private forceRender = true
  /** Timer measuring frame deltas */
  private timer!: THREE.Timer

  /** The 3D scene */
  scene!: THREE.Scene

  /** Perspective camera */
  private camera!: THREE.PerspectiveCamera
  /** Camera controls */
  private cameraControls!: CameraControls
  /** Seconds the camera has sat idle */
  private cameraIdleTime = 0

  /** The active navigation mode */
  private navigationMode: NavigationMode = NAVIGATION_MODES.prusaslicer
  /** Modifier key currently held down */
  private navigationModifier: 'shift' | 'ctrl' | null = null

  /** Camera rendering the metallic reflections on the nozzle */
  private reflectionCamera!: THREE.CubeCamera

  /** Light under the bed */
  private underBedLight!: THREE.PointLight
  /** Light following the camera */
  private cameraLight!: THREE.PointLight

  /** Nozzle model, once loaded */
  private nozzleModel: THREE.Group | null = null
  /** Material shared by the nozzle model meshes, once loaded */
  private nozzleMaterial: THREE.MeshStandardMaterial | null = null

  /**
   * Planes bounding the gcode reflection to the bed surface, each through the camera and a bed
   * edge, so a reflected point shows only where the line of sight crosses the bed; updated each frame
   */
  readonly mirrorBoundsPlanes = [new THREE.Plane(), new THREE.Plane(), new THREE.Plane(), new THREE.Plane()]

  /* ---- Setup ---- */

  /**
   * @param settings - Plugin frontend settings
   * @param getBedVolume - Getter of the current print bed geometry
   * @param onFrame - Callback advancing the print view each frame, run before rendering
   */
  constructor (settings: Settings, getBedVolume: () => BedVolume, onFrame: (deltaSeconds: number) => PrintViewUpdate) {
    this.settings = settings
    this.getBedVolume = getBedVolume
    this.onFrame = onFrame
  }

  /** Sets up the 3D view and starts its render loop */
  init () {
    const settings = this.settings
    const bedVolume = this.getBedVolume()
    const canvas = document.getElementById('pg-canvas') as HTMLCanvasElement

    // Renderer
    THREE.ColorManagement.enabled = false
    this.createRenderer(canvas, settings.antialias)

    // Camera and controls
    this.camera = new THREE.PerspectiveCamera(70, 2, 1, 5000)
    this.camera.up.set(0, 0, 1)
    this.camera.position.set(bedVolume.width, 0, 50)
    CameraControls.install({ THREE: CAMERA_CONTROLS_THREE })
    this.cameraControls = new CameraControls(this.camera, canvas)
    this.cameraControls.dollyToCursor = true
    this.cameraControls.infinityDolly = true
    this.cameraControls.minDistance = 10
    this.applyNavigationMode(settings.navigationMode)
    this.resetCameraTarget()

    // Watch navigation modifiers
    window.addEventListener('keydown', (event) => this.updateNavigationModifier(event))
    window.addEventListener('keyup', (event) => this.updateNavigationModifier(event))
    window.addEventListener('blur', () => this.updateNavigationModifier(null))

    // Scene
    this.scene = new THREE.Scene()
    this.applyBackground(settings.darkMode)

    // Bed (grid)
    this.updateBedMesh()

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

  /**
   * Creates the WebGL renderer bound to a canvas
   * @param canvas - Canvas to render into
   * @param antialias - True to enable antialiasing
   */
  private createRenderer (canvas: HTMLCanvasElement, antialias: boolean) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias, logarithmicDepthBuffer: true })
    this.renderer.setPixelRatio(window.devicePixelRatio)
    this.renderer.localClippingEnabled = true // Needed for the gcode reflection on the bed surface
  }

  /** Loads the nozzle model and shows it in the scene once ready */
  loadNozzle () {
    new THREE.OBJLoader().load(NOZZLE_MODEL_URL, (obj) => {
      obj.rotation.x = Math.PI / 2
      obj.scale.setScalar(0.1)
      obj.position.set(0, 0, 10)
      const material = new THREE.MeshStandardMaterial({
        metalness: 1,
        roughness: 0.5,
        envMap: this.reflectionCamera.renderTarget.texture,
        color: NOZZLE_COLOR
      })
      // Depth-only twins drawn first keep the transparency uniform on the outer surface
      const depthMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, transparent: true })
      obj.children.slice().forEach((child) => {
        if (child instanceof THREE.Mesh) {
          child.material = material
          child.renderOrder = 2
          const twin = new THREE.Mesh(child.geometry, depthMaterial)
          twin.renderOrder = 1
          obj.add(twin)
        }
      })
      this.nozzleModel = obj
      this.nozzleMaterial = material
      this.scene.add(obj)
      this.requestRender()
    })
  }

  /* ---- Render loop ---- */

  /** Renders a frame when needed and schedules the next one */
  private animate () {
    const settings = this.settings

    this.timer.update()
    const deltaSeconds = this.timer.getDelta()

    let needRender = this.forceRender
    this.forceRender = false

    // Skip animation if canvas size is 0 (e.g. plugin tab is not shown)
    const canvas = this.renderer.domElement
    if (canvas.clientWidth === 0 || canvas.clientHeight === 0) {
      // Schedule the next frame and return
      requestAnimationFrame(() => this.animate())
      return
    }

    // Toggle the nozzle reflection to match the setting
    const envMap = settings.nozzleReflection ? this.reflectionCamera.renderTarget.texture : null
    if (this.nozzleMaterial && this.nozzleMaterial.envMap !== envMap) {
      this.nozzleMaterial.envMap = envMap
      this.nozzleMaterial.metalness = envMap ? 1 : 0
      this.nozzleMaterial.roughness = envMap ? 0.5 : 1
      this.nozzleMaterial.color.setHex(envMap ? NOZZLE_COLOR : NOZZLE_UNREFLECTIVE_COLOR)
      this.nozzleMaterial.emissive.setHex(envMap ? 0x000000 : NOZZLE_UNREFLECTIVE_COLOR)
      this.nozzleMaterial.emissiveIntensity = NOZZLE_UNREFLECTIVE_EMISSIVE
      this.nozzleMaterial.needsUpdate = true
      needRender = true
    }

    // Rebuild the nozzle reflection
    if (needRender && settings.nozzleReflection) this.reflectionCamera.update(this.renderer, this.scene)

    // Update and get the print view
    const printView = this.onFrame(deltaSeconds)
    if (printView.needRender) needRender = true

    // Update nozzle model position
    if (this.nozzleModel) {
      if (printView.nozzlePosition) {
        this.nozzleModel.position.copy(printView.nozzlePosition)
      } else if (this.nozzleModel.position.lengthSq()) {
        this.nozzleModel.position.set(0, 0, 0)
        needRender = true
      }
    }

    // Fade the nozzle to match the transparency setting
    const nozzleOpacity = 1 - settings.nozzleTransparency / 100
    if (this.nozzleModel && this.nozzleMaterial && this.nozzleMaterial.opacity !== nozzleOpacity) {
      this.nozzleMaterial.opacity = nozzleOpacity
      this.nozzleMaterial.transparent = nozzleOpacity < 1
      this.nozzleMaterial.needsUpdate = true
      this.nozzleModel.visible = nozzleOpacity > 0
      needRender = true
    }

    // Auto-orbit once the camera has sat idle a while
    if (this.cameraControls.update(deltaSeconds)) {
      this.cameraIdleTime = 0
      needRender = true
    } else {
      this.cameraIdleTime += deltaSeconds
      if (settings.orbitWhenIdle && this.cameraIdleTime > ORBIT_IDLE_DELAY_SECONDS) {
        this.cameraControls.rotate(deltaSeconds / 5.0, 0, false)
        this.cameraControls.update(deltaSeconds)
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

  /** Forces a render on the next animation frame */
  requestRender () {
    this.forceRender = true
  }

  /**
   * Matches the rendering size to the canvas display size
   * @returns True if the size changed
   */
  private resizeCanvasToDisplaySize () {
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

  /** (Re)builds the bed plane and grid to match the current bed geometry */
  updateBedMesh () {
    if (!this.scene) return

    const bedVolume = this.getBedVolume()

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

  /**
   * Points the camera back at the bed center
   * @param enableTransition - True to animate the move
   */
  resetCameraTarget (enableTransition = false) {
    if (!this.cameraControls) return

    const bedVolume = this.getBedVolume()
    const lowerleft = bedVolume.origin === 'lowerleft'

    // Aim at the bed center
    const targetX = lowerleft ? bedVolume.width / 2 : 0
    const targetY = lowerleft ? bedVolume.depth / 2 : 0

    this.cameraControls.setTarget(targetX, targetY, 0, enableTransition)
  }

  /**
   * Adjusts the camera to show the given bounds
   * @param bounds - Box to frame, in scene coordinates
   */
  frameBounds (bounds: THREE.Box3) {
    // Re-center on the bed first
    this.resetCameraTarget(true)

    // Pull back to roughly the print's footprint, with a floor for tiny models
    const size = bounds.getSize(new THREE.Vector3())
    this.cameraControls.dollyTo(Math.max(40, size.x, size.y), true)
  }

  /** (Re)computes the planes that clip the bed reflection to the bed surface */
  private updateMirrorBoundsPlanes () {
    const bedVolume = this.getBedVolume()
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

  /**
   * Applies the light or dark background to the scene
   * @param darkMode - True for the dark background
   */
  applyBackground (darkMode: boolean) {
    this.scene.background = new THREE.Color(darkMode ? DARK_BACKGROUND : LIGHT_BACKGROUND)
    this.requestRender()
  }

  /**
   * Switches the mouse mappings to the given navigation mode
   * @param mode - NAVIGATION_MODES key
   */
  applyNavigationMode (mode: NavigationModeKey) {
    this.navigationMode = NAVIGATION_MODES[mode] ?? NAVIGATION_MODES.prusaslicer
    this.applyMouseBindings()
  }

  /**
   * (Re)applies the mouse bindings for the held modifier key
   * @param event - Event carrying the modifier key state, or null when the window loses focus
   */
  private updateNavigationModifier (event: KeyboardEvent | null) {
    const modifier = event?.shiftKey ? 'shift' : event?.ctrlKey ? 'ctrl' : null
    if (modifier !== this.navigationModifier) {
      this.navigationModifier = modifier
      this.applyMouseBindings()
    }
  }

  /** Binds each mouse button to its action in the active navigation mode */
  private applyMouseBindings () {
    const actions: Array<[MouseBinding | MouseBinding[] | undefined, number]> = [
      [this.navigationMode.orbit, CameraControls.ACTION.ROTATE],
      [this.navigationMode.pan, CameraControls.ACTION.TRUCK],
      [this.navigationMode.zoom, CameraControls.ACTION.DOLLY]
    ]

    const buttons: Record<MouseButton, number> = { left: CameraControls.ACTION.NONE, middle: CameraControls.ACTION.NONE, right: CameraControls.ACTION.NONE }
    const modifierButtons: Partial<typeof buttons> = {}
    for (const [bindings, action] of actions) {
      for (const binding of [bindings ?? []].flat()) {
        const [button, modifier] = binding.split('+').reverse() as [MouseButton, string?]
        if (modifier === undefined) buttons[button] = action
        else if (modifier === this.navigationModifier) modifierButtons[button] = action
      }
    }
    Object.assign(this.cameraControls.mouseButtons, buttons, modifierButtons)
  }

  /**
   * Turns renderer antialiasing on or off
   * @param antialias - True to enable antialiasing
   */
  applyAntialias (antialias: boolean) {
    // Antialias is a fixed WebGL context attribute, so toggling it means recreating the
    // context. A context stays bound to its canvas, so swap in a fresh canvas too.
    const oldCanvas = this.renderer.domElement
    const canvas = oldCanvas.cloneNode(false) as HTMLCanvasElement

    oldCanvas.replaceWith(canvas)

    this.cameraControls.disconnect()
    this.renderer.dispose()

    this.createRenderer(canvas, antialias)
    this.cameraControls.connect(canvas)

    this.requestRender()
  }
}
