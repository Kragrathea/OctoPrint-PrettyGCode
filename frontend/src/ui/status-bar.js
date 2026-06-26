export function setStatusBarText (text) {
  $('.pg-status').text(text)
}

export function applyStatusBarVisibility (show) {
  $('.pg-status').toggleClass('pg-hidden', !show)
}
