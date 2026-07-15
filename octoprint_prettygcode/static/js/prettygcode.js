$(function () {
  function PrettyGCodeViewModel (parameters) {
    const app = new PrettyGCode.App({
      printerProfilesVM: parameters[0],
      settingsVM: parameters[1]
    })

    this.onTabChange = (current, previous) => app.onTabChange(current, previous)

    this.fromCurrentData = (data) => app.fromCurrentData(data)
    this.fromHistoryData = (data) => app.fromHistoryData(data)
    this.onDataUpdaterPluginMessage = (plugin, data) => app.onDataUpdaterPluginMessage(plugin, data)
  }

  OCTOPRINT_VIEWMODELS.push({
    construct: PrettyGCodeViewModel,
    dependencies: ['printerProfilesViewModel', 'settingsViewModel'],
    elements: ['#tab_plugin_prettygcode']
  })
})
