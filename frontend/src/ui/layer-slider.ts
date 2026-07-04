import type { PrettyGCodeApp } from '../app'

export function initLayerSlider (app: PrettyGCodeApp) {
  $('.pg-view').append('<div id="pg-layer-slider"></div>')
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
    $('#pg-layer-slider-ui .slider-handle').text(event.value)
  }).on('slideStart', () => {
    app.setManualLayerControl(true)
  }).on('slideStop', () => {
    app.setManualLayerControl(false)
  })
}

export function setLayerSliderMax (layerCount: number) {
  if (!$('#pg-layer-slider').length) return

  $('#pg-layer-slider').slider('setMax', layerCount)
  $('#pg-layer-slider').slider(layerCount ? 'enable' : 'disable')

  setLayerSliderValue(layerCount)
}

export function setLayerSliderValue (layer: number) {
  if (!$('#pg-layer-slider').length) return

  $('#pg-layer-slider').slider('setValue', layer)
  $('#pg-layer-slider-ui .slider-handle').text(layer)
}
