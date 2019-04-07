# coding=utf-8
from __future__ import absolute_import

import octoprint.plugin

class UIInjectorPlugin(octoprint.plugin.StartupPlugin,
                       octoprint.plugin.TemplatePlugin):
    def on_after_startup(self):
        self._logger.info("UI Injector Started.")
    pass

# If you want your plugin to be registered within OctoPrint under a different name than what you defined in setup.py
# ("OctoPrint-PluginSkeleton"), you may define that here. Same goes for the other metadata derived from setup.py that
# can be overwritten via __plugin_xyz__ control properties. See the documentation for that.
__plugin_name__ = "UI Injector"
__plugin_implementation__ = UIInjectorPlugin()
