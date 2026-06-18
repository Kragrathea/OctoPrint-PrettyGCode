import octoprint.plugin


class PrettyGCodePlugin(
    octoprint.plugin.AssetPlugin,
    octoprint.plugin.SettingsPlugin,
    octoprint.plugin.StartupPlugin,
    octoprint.plugin.TemplatePlugin,
):
    def get_assets(self):
        return dict(
            js=[
                "js/prettygcode.js",
                "js/three.min.js",
                "js/LineSegmentsGeometry.js",
                "js/LineGeometry.js",
                "js/OBJLoader.js",
                "js/LineMaterial.js",
                "js/LineSegments2.js",
                "js/Line2.js",
                "js/camera-controls.js",
                "js/dat.gui.js",
            ],
            css=["css/prettygcode.css"],
        )

    def is_template_autoescaped(self):
        return True

    def get_update_information(self):
        return dict(
            prettygcode=dict(
                displayName=self._plugin_name,
                displayVersion=self._plugin_version,
                type="github_release",
                user="jacopotediosi",
                repo="OctoPrint-PrettyGCode",
                current=self._plugin_version,
                pip="https://github.com/jacopotediosi/OctoPrint-PrettyGCode/archive/{target_version}.zip",
            )
        )


__plugin_name__ = "PrettyGCode"
__plugin_pythoncompat__ = ">=3.7,<4"
__plugin_implementation__ = PrettyGCodePlugin()
__plugin_hooks__ = {"octoprint.plugin.softwareupdate.check_config": __plugin_implementation__.get_update_information}
