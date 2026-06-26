import { PrettyGCodeApp } from './src/app.js'

// Exposed as a global so the OctoPrint view model (prettygcode.js) can instantiate it
window.PrettyGCode = { App: PrettyGCodeApp }
