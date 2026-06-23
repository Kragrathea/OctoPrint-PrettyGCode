import {updateWebcamStream} from "./webcam.js";
import {applyStatusBarVisibility} from "./status-bar.js";

const MIN_OVERLAY_HEIGHT = 50; // px
const MAX_OVERLAY_HEIGHT_FRACTION = 0.9; // share of viewport height
const DEFAULT_OVERLAY_HEIGHT_FRACTION = 1 / 3; // share of viewport height

let dashboardScale = 1;

function defaultOverlayHeight() {
    return Math.round(window.innerHeight * DEFAULT_OVERLAY_HEIGHT_FRACTION);
}

function clampOverlayHeight(height) {
    return Math.min(window.innerHeight * MAX_OVERLAY_HEIGHT_FRACTION, Math.max(MIN_OVERLAY_HEIGHT, height));
}

function setWebcamHeight(height) {
    $("#pg-webcam").css("height", clampOverlayHeight(height) + "px");
}

function setDashboardScale(scale) {
    const dasboardElement = document.getElementById("tab_plugin_dashboard");
    if (!dasboardElement) return;

    if (dasboardElement.offsetHeight)
        scale = clampOverlayHeight(dasboardElement.offsetHeight * scale) / dasboardElement.offsetHeight;

    dasboardElement.style.setProperty("--pg-dash-scale", scale);
    dashboardScale = scale;
}

function setDashboardDefaultScale(app) {
    if (app.settings.dashboardScale) return; // The scale is already saved in settings

    const naturalHeight = document.getElementById("tab_plugin_dashboard")?.offsetHeight;
    if (naturalHeight) setDashboardScale(defaultOverlayHeight() / naturalHeight);
}

export function updateWindowStates(app) {
    const settings = app.settings;

    applyStatusBarVisibility(settings.showStatusBar);

    $("#state_wrapper").toggleClass("pg-hidden", !settings.showState);
    $("#files_wrapper").toggleClass("pg-hidden", !settings.showFiles);

    $("#tab_plugin_dashboard").toggleClass("pg-hidden", !settings.showDashboard);
    if (settings.showDashboard && $(".page-container").hasClass("pg-maximized")) setDashboardDefaultScale(app);

    $(".pg-view #pg-webcam").toggleClass("pg-hidden", !settings.showWebcam);
    if (settings.showWebcam) setWebcamHeight(settings.webcamHeight || defaultOverlayHeight());
    updateWebcamStream(app);
}

// Each overlay keeps its proportions, so resizing scales a single driver (webcam
// height in px, dashboard scale): dragging `axis` in `direction` changes the dragged
// dimension, and the driver scales by the same relative amount.
function makeResizable($handle, overlay, axis, direction) {
    const pointerCoord = axis === "x" ? "clientX" : "clientY";
    $handle.on("pointerdown", function (e) {
        const pointerEvent = e.originalEvent || e;
        e.preventDefault();
        e.stopPropagation();

        const startState = overlay.measure();
        const startCoord = pointerEvent[pointerCoord];
        const startDimension = axis === "x" ? startState.width : startState.height;
        if (this.setPointerCapture) this.setPointerCapture(pointerEvent.pointerId);

        const onMove = (ev) => {
            const delta = direction * ((ev.originalEvent || ev)[pointerCoord] - startCoord);
            if (startDimension) overlay.apply(startState.driver * (startDimension + delta) / startDimension);
        };
        const onUp = () => {
            $handle.off("pointermove", onMove).off("pointerup pointercancel", onUp);
            overlay.persist();
        };
        $handle.on("pointermove", onMove).on("pointerup pointercancel", onUp);
    });
}

export function initOverlayWindows(app) {
    const webcamOverlay = {
        measure() {
            const rect = $("#pg-webcam")[0].getBoundingClientRect();
            return {driver: rect.height, width: rect.width, height: rect.height};
        },
        apply: setWebcamHeight,
        persist() {
            app.settings.webcamHeight = Math.round($("#pg-webcam").height());
            app.settings.save();
        },
    };

    $(".pg-view").append('<div id="pg-webcam"><img id="pg-webcam-image"><div class="pg-resize-handle pg-resize-top"></div><div class="pg-resize-handle pg-resize-left"></div></div>');
    setWebcamHeight(app.settings.webcamHeight || defaultOverlayHeight());
    makeResizable($("#pg-webcam .pg-resize-top"), webcamOverlay, "y", -1);
    makeResizable($("#pg-webcam .pg-resize-left"), webcamOverlay, "x", -1);

    const $dashboard = $("#tab_plugin_dashboard");
    if ($dashboard.length) {
        const dashboardOverlay = {
            measure() {
                const rect = $dashboard[0].getBoundingClientRect();
                return {driver: dashboardScale, width: rect.width, height: rect.height};
            },
            apply: setDashboardScale,
            persist() {
                app.settings.dashboardScale = dashboardScale;
                app.settings.save();
            },
        };

        setDashboardScale(app.settings.dashboardScale || 1);
        $dashboard.append('<div class="pg-resize-handle pg-resize-top"></div><div class="pg-resize-handle pg-resize-right"></div>');
        makeResizable($dashboard.children(".pg-resize-top"), dashboardOverlay, "y", -1);
        makeResizable($dashboard.children(".pg-resize-right"), dashboardOverlay, "x", 1);
    }
}
