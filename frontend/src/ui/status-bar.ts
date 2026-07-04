export function setStatusBarText (text: string) {
  $('.pg-status').text(text)
}

export function applyStatusBarVisibility (show: boolean) {
  $('.pg-status').toggleClass('pg-hidden', !show)
}
