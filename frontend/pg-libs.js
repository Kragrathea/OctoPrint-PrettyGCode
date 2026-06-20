// Entry point bundled by build.mjs into static/js/lib/pg-libs.bundle.js (run: task build-frontend)

// The following are ES modules; expose them as globals so the OctoPrint view model can keep using them
import * as THREE from "three";
import {OBJLoader} from "three/addons/loaders/OBJLoader.js";
import {LineSegments2} from "three/addons/lines/LineSegments2.js";
import {LineSegmentsGeometry} from "three/addons/lines/LineSegmentsGeometry.js";
import {LineMaterial} from "three/addons/lines/LineMaterial.js";
import CameraControls from "camera-controls";
import GUI from "lil-gui";

// THREE is a read-only module namespace, so copy it into a plain object that also carries
// the addons, then expose it for the view model
window.THREE = Object.assign({}, THREE, {OBJLoader, LineSegments2, LineSegmentsGeometry, LineMaterial});
window.CameraControls = CameraControls;
window.lil = {GUI};
