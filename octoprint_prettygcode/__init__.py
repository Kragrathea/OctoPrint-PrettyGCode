import octoprint.plugin

GITHUB_URL = "https://github.com/jacopotediosi/OctoPrint-PrettyGCode"


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
                "js/lib/three.min.js",
                "js/lib/LineSegmentsGeometry.js",
                "js/lib/LineGeometry.js",
                "js/lib/OBJLoader.js",
                "js/lib/LineMaterial.js",
                "js/lib/LineSegments2.js",
                "js/lib/Line2.js",
                "js/lib/camera-controls.js",
                "js/lib/lil-gui.umd.min.js",
            ],
            css=["css/prettygcode.css"],
        )

    def is_template_autoescaped(self):
        return True

    def get_template_vars(self):
        return dict(github_url=GITHUB_URL)

    def get_update_information(self):
        return dict(
            prettygcode=dict(
                displayName=self._plugin_name,
                displayVersion=self._plugin_version,
                type="github_release",
                user="jacopotediosi",
                repo="OctoPrint-PrettyGCode",
                current=self._plugin_version,
                pip=GITHUB_URL + "/archive/{target_version}.zip",
            )
        )


__plugin_name__ = "PrettyGCode"
__plugin_pythoncompat__ = ">=3.7,<4"
__plugin_implementation__ = PrettyGCodePlugin()
__plugin_hooks__ = {"octoprint.plugin.softwareupdate.check_config": __plugin_implementation__.get_update_information}
