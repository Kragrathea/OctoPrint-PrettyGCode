export function initLayerSlider (app) {
  $('.pg-view').append('<div id="pg-layer-slider"></div>')
  $('#pg-layer-slider').slider({
    id: 'pg-layer-slider-ui',
    orientation: 'vertical',
    reversed: true,
    tooltip: 'hide',
    min: 0,
    max: 100,
    value: 100
  }).on('slide', (event) => {
    app.setCurrentLayerNumber(event.value)
    $('#pg-layer-slider-ui .slider-handle').text(event.value)
  }).on('slideStart', () => {
    app.setManualLayerControl(true)
  }).on('slideStop', () => {
    app.setManualLayerControl(false)
  })
}

export function setLayerSliderMax (layerCount) {
  if (!$('#pg-layer-slider').length) return

  $('#pg-layer-slider').slider('setMax', layerCount)
  $('#pg-layer-slider').slider(layerCount ? 'enable' : 'disable')

  setLayerSliderValue(layerCount)
}

export function setLayerSliderValue (layer) {
  if (!$('#pg-layer-slider').length) return

  $('#pg-layer-slider').slider('setValue', layer)
  $('#pg-layer-slider-ui .slider-handle').text(layer)
}
