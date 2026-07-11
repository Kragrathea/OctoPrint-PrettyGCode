import type { PrettyGCodeApp } from '../app'

/** Milliseconds a step button must be held before it auto-repeats */
const STEP_HOLD_DELAY_MS = 500
/** Milliseconds between steps while a step button is held */
const STEP_HOLD_REPEAT_MS = 50

/**
 * Creates the layer slider
 * @param app - Application instance
 */
export function initLayerSlider (app: PrettyGCodeApp) {
  /**
   * Moves the displayed layer by a delta
   * @param delta - Layers to move by, negative to go down
   */
  const stepLayer = (delta: number) => {
    const layer = Math.min(Math.max(app.currentLayerNumber + delta, 0), app.layerCount)
    app.setCurrentLayerNumber(layer)
  }

  /**
   * Makes a button step the layer once per click and repeatedly while held
   * @param button - Selector of the step button
   * @param delta - Layers to move per step
   */
  const bindStepButton = (button: string, delta: number) => {
    let delayTimer: number | undefined
    let repeatTimer: number | undefined
    let repeated = false

    const release = () => {
      clearTimeout(delayTimer)
      clearInterval(repeatTimer)
      app.setManualLayerControl(false)
      $(document).off('pointerup pointercancel', release)
    }

    $(button).on('pointerdown', () => {
      repeated = false
      app.setManualLayerControl(true)
      delayTimer = window.setTimeout(() => {
        repeatTimer = window.setInterval(() => {
          repeated = true
          stepLayer(delta)
        }, STEP_HOLD_REPEAT_MS)
      }, STEP_HOLD_DELAY_MS)
      $(document).on('pointerup pointercancel', release)
    }).on('click', () => {
      if (!repeated) stepLayer(delta)
      repeated = false
    })
  }

  // Create HTML elements
  $('.pg-view').append(
    '<button id="pg-layer-step-up-button" class="pg-layer-step-button btn" title="Layer up" disabled><i class="fa-solid fa-chevron-up"></i></button>',
    '<div id="pg-layer-slider"></div>',
    '<button id="pg-layer-step-down-button" class="pg-layer-step-button btn" title="Layer down" disabled><i class="fa-solid fa-chevron-down"></i></button>'
  )

  // Initialize the slider
  $('#pg-layer-slider').slider({
    id: 'pg-layer-slider-ui',
    orientation: 'vertical',
    reversed: true,
    tooltip: 'hide',
    min: 0,
    max: 100,
    value: 100
  }).on('slide', (event: any) => {
    app.setCurrentLayerNumber(event.value)
  }).on('slideStart', () => {
    app.setManualLayerControl(true)
  }).on('slideStop', () => {
    app.setManualLayerControl(false)
  })

  // Bind the step buttons
  bindStepButton('#pg-layer-step-up-button', 1)
  bindStepButton('#pg-layer-step-down-button', -1)
}

/**
 * (Re)adapts the slider to the loaded gcode's layer count
 * @param app - Application instance
 */
export function updateLayerSliderMax (app: PrettyGCodeApp) {
  if (!$('#pg-layer-slider').length) return

  $('#pg-layer-slider').slider('setMax', app.layerCount)
  $('#pg-layer-slider').slider(app.layerCount ? 'enable' : 'disable')

  setLayerSliderValue(app, app.layerCount)
}

/**
 * Moves the slider to a layer
 * @param app - Application instance
 * @param layer - 1-based layer number
 */
export function setLayerSliderValue (app: PrettyGCodeApp, layer: number) {
  if (!$('#pg-layer-slider').length) return

  $('#pg-layer-slider').slider('setValue', layer)
  $('#pg-layer-slider-ui .slider-handle').text(layer)

  $('#pg-layer-step-up-button').prop('disabled', layer >= app.layerCount)
  $('#pg-layer-step-down-button').prop('disabled', layer <= 0)
}
