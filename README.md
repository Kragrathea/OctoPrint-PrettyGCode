# OctoPrint Pretty GCode Viewer

This plugin adds a 3D GCode visualizer tab in Octoprint. It displays colored lines to give you some idea what the printer is doing and animates progress during printing.

![Screenshot](/extras/images/screen_1.jpg)

## Features
- 3D G-code visualizer
- Paths color-coded by slicer feature (perimeters, infill, support, skirt…)
- Layer slider to scrub through the model
- Syncs to the print job with an animated nozzle
- Temperature status bar
- Tabbed, maximized and fullscreen views
- Resizable webcam inset and [Dashboard](https://plugins.octoprint.org/plugins/dashboard/) plugin window (if installed)
- Many view options, e.g. dark mode, mirror reflection on bed's plate, antialiasing and idle auto-orbit

## Common Issues

### 3D view sync
PrettyGCode does its best to simulate the nozzle position during a print, but it's only an estimate with no guarantee of accuracy: OctoPrint has no real way of knowing where the print head actually is. Please note also that a short delay behind the printer is expected and unavoidable.

If, however, the sync looks completely off during a print, please [open a bug report](#how-to-report-bugs) and attach the file you were printing.

### Performance and WebGL
PrettyGCode renders with WebGL via Three.js.

WebGL isn't supported on every browser, and rendering can be slow on older machines, especially with large models.

### Streaming via OBS Studio
OBS can render the 3D view only when GPU acceleration is enabled.

To fix this, please launch OBS with the `--enable-gpu` flag.

### Apple Safari
Some Safari users have reported crashes when the page loads. To fix this, please enable `GPU Process: WebGL` in Safari as shown below and restart the browser.

![Enable WebGL on Safari](https://user-images.githubusercontent.com/133423/134966512-13385218-b57b-45df-b6ba-b600722775bf.png)

## How to report bugs
Found a bug or have an idea to make PrettyGCode better? I'd love to hear it!

Just open a ticket on the [Issues tab](https://github.com/jacopotediosi/OctoPrint-PrettyGCode/issues) on GitHub and I'll take a look.

Thanks for helping out!
