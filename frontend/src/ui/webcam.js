function getStreamUrl(app) {
    const fallback = "/webcam/?action=stream";
    try {
        const webcam = app.settingsVM.settings.webcam;
        const defaultCam = ko.utils.arrayFirst((webcam.webcams && webcam.webcams()) || [], (c) => ko.unwrap(c.name) === ko.unwrap(webcam.defaultWebcam));
        const compat = defaultCam && ko.unwrap(defaultCam.compat);
        return (compat && ko.unwrap(compat.stream)) || (webcam.streamUrl && webcam.streamUrl()) || fallback;
    } catch {
        return fallback;
    }
}

export function updateWebcamStream(app) {
    const image = $(".pg-view #pg-webcam-image");

    // Stream only while the webcam is actually visible: our tab selected, maximized, and the setting enabled
    const visible = OctoPrint.coreui.selectedTab === "#tab_plugin_prettygcode" && image.closest(".page-container").hasClass("pg-maximized") && app.settings.showWebcam;

    // Already in the desired state? Leave it: re-setting src would restart the live stream
    if (visible === !!image.attr("src")) return;

    if (visible) {
        const url = getStreamUrl(app);
        image.attr("src", url + (url.includes("?") ? "&" : "?") + Math.random());
    } else {
        image.attr("src", "");
    }
}
