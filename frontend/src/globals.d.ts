// Globals available on the OctoPrint page

// OctoPrint client library
declare const OctoPrint: any

// Knockout
declare const ko: any

// Injected by the OctoPrint asset pipeline
declare const VERSION: string
declare const PLUGIN_BASEURL: string

// bootstrap-slider jQuery plugin
interface JQuery {
  slider (methodOrOptions?: any, ...args: any[]): JQuery
}
