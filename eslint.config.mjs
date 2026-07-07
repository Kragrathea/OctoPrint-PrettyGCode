import neostandard from 'neostandard'

export default neostandard({
  ts: true,
  env: ['browser'],
  globals: ['$', 'ko', 'OctoPrint', 'OCTOPRINT_VIEWMODELS', 'PrettyGCode', 'VERSION', 'PLUGIN_BASEURL'],
  ignores: ['octoprint_prettygcode/static/js/pg-main.bundle.js']
})
