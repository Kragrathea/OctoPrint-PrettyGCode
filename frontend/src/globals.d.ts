// Globals available on the OctoPrint page

/** OctoPrint client library */
declare const OctoPrint: any

/** Knockout */
declare const ko: any

/** OctoPrint version, injected by the asset pipeline */
declare const VERSION: string

/** Plugin assets base URL, injected by the asset pipeline */
declare const PLUGIN_BASEURL: string

interface JQuery {
  /** bootstrap-slider jQuery plugin */
  slider (methodOrOptions?: any, ...args: any[]): JQuery
}
