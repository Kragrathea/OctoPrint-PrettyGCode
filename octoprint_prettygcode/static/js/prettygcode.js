$(function () {
  function PrettyGCodeViewModel (parameters) {
    const app = new PrettyGCode.App({
      printerProfilesVM: parameters[0]
    })

    this.onTabChange = (current, previous) => app.onTabChange(current, previous)

    this.fromCurrentData = (data) => app.fromCurrentData(data)
    this.fromHistoryData = (data) => app.fromHistoryData(data)
  }

  OCTOPRINT_VIEWMODELS.push({
    construct: PrettyGCodeViewModel,
    dependencies: ['printerProfilesViewModel'],
    elements: ['#tab_plugin_prettygcode']
  })
})
