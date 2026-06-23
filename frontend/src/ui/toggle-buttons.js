import {updateWindowStates} from "./overlay-windows.js";

let wasMaximized = false;

export function initToggleButtons(app) {
    // Restore the maximized layout from the URL (bookmarked/embedded maximized view)
    if (new URLSearchParams(location.search).get("maximized")) $(".page-container").addClass("pg-maximized");

    $(".pg-toggle-maximized").on("click", () => {
        if (document.fullscreenElement) {
            document.exitFullscreen();
            return;
        }

        // Update maximized parameter in URL
        const max = $(".page-container").toggleClass("pg-maximized").hasClass("pg-maximized");
        const url = new URL(window.location.href);
        if (max) url.searchParams.set("maximized", "1");
        else url.searchParams.delete("maximized");
        history.replaceState(null, "", url);

        updateWindowStates(app);
    });

    $(".pg-toggle-fullscreen").on("click", () => {
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else {
            // Remember the maximized state from before entering fullscreen, to restore it on exit
            wasMaximized = $(".page-container").hasClass("pg-maximized");

            $(".page-container").addClass("pg-maximized");
            $(".page-container")[0].requestFullscreen();

            updateWindowStates(app);
        }
    });
    $(document).on("fullscreenchange", () => {
        if (!document.fullscreenElement) {
            // Leaving fullscreen restores the maximized state from before entering it
            $(".page-container").toggleClass("pg-maximized", wasMaximized);
            updateWindowStates(app);
        }
    });

    $(".pg-toggle-settings").on("click", () => $("#pg-view-settings").toggleClass("pg-hidden"));

    $(".pg-toggle-state").on("click", () => {
        app.settings.showState = !app.settings.showState;
        app.settings.save();
        updateWindowStates(app);
    });
    $(".pg-toggle-files").on("click", () => {
        app.settings.showFiles = !app.settings.showFiles;
        app.settings.save();
        updateWindowStates(app);
    });

    $(".pg-toggle-webcam").on("click", () => {
        app.settings.showWebcam = !app.settings.showWebcam;
        app.settings.save();
        updateWindowStates(app);
    });
    $(".pg-toggle-dashboard").on("click", () => {
        app.settings.showDashboard = !app.settings.showDashboard;
        app.settings.save();
        updateWindowStates(app);
    });
}
