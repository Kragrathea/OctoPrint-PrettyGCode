$(function () {
    function PrettyGCodeViewModel(parameters) {
        const app = new PrettyGCode.App({
            settingsVM: parameters[0],
            printerProfilesVM: parameters[1],
        });

        this.onTabChange = (current, previous) => app.onTabChange(current, previous);

        this.fromCurrentData = (data) => app.fromCurrentData(data);
        this.fromHistoryData = (data) => app.fromHistoryData(data);
    }

    OCTOPRINT_VIEWMODELS.push({
        construct: PrettyGCodeViewModel,
        dependencies: ["settingsViewModel", "printerProfilesViewModel"],
        elements: ["#tab_plugin_prettygcode"],
    });
});
