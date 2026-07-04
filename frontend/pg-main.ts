import { PrettyGCodeApp } from './src/app'

declare global {
  interface Window { PrettyGCode: { App: typeof PrettyGCodeApp } }
}

// Exposed as a global so the OctoPrint view model (prettygcode.js) can instantiate it
window.PrettyGCode = { App: PrettyGCodeApp }
