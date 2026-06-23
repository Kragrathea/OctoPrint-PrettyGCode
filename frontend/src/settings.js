const STORAGE_KEY = "pg-settings";

export class Settings {
    // Settings in settings panel
    darkMode = false;
    showMirror = false;
    orbitWhenIdle = false;
    thickLines = true;
    antialias = true;
    showNozzle = true;
    showStatusBar = true;

    // Toggle buttons
    showState = true;
    showFiles = false;

    // Overlay windows
    showWebcam = false;
    showDashboard = false;

    // Overlay window sizes
    webcamHeight = 0;
    dashboardScale = 0;

    load() {
        try {
            const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
            for (const key in saved) {
                if (key in this) {
                    this[key] = saved[key];
                }
            }
        } catch (e) {}
    }

    save() {
        try {
            const data = {};
            for (const key of Object.keys(this)) {
                data[key] = this[key];
            }
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch (e) {}
    }
}
