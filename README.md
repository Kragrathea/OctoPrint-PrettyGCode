OctoPrint Plugin Skeleton
=========================

This is a basic plugin skeleton that you can use as a basis for your own OctoPrint plugin.

You can copy the files to a folder of your choice, or just clone this repository, renaming it in the process. Then 
modify ``setup.py`` to fit your plugin, rename ``octoprint_skeleton`` accordingly and finally implement your plugin 
under ``octoprint_<plugin identifier>``.

Example Usage
-------------

Clone your repository into a new development directory and rename ``octoprint_skeleton``:

    git clone https://github.com/OctoPrint/OctoPrint-PluginSkeleton OctoPrint-MyNewPlugin
    cd OctoPrint-MyNewPlugin
    mv octoprint_skeleton octoprint_mynewplugin

Modify `setup.py`'s `plugin_<xyz>` settings so that they match your plugin, e.g.:

``` python
plugin_identifier = "mynewplugin"
plugin_name = "OctoPrint-MyNewPlugin"
plugin_version = "1.0"
plugin_description = "Awesome plugin that does something"
plugin_author = "You"
plugin_author_email = "you@somewhere.net"
plugin_url = "https://github.com/you/OctoPrint-MyNewPlugin"
```

Then implement your plugin under ``octoprint_mynewplugin`` (don't forget to adjust ``__init__.py``!), e.g.:

``` python
# coding=utf-8
from __future__ import absolute_import

import octoprint.plugin

class HelloWorldPlugin(octoprint.plugin.StartupPlugin):
    def on_after_startup(self):
        self._logger.info("Hello World!")
        
__plugin_name__ = "Hello World"
__plugin_implementation__ = HelloWorldPlugin()
```

Test it (e.g. via ``python setup.py develop``). If everything works, write a nice ``README.md``, replacing the existing one.
Commit your code, then push it to your plugin's repository (this assumes you already created it on Github as
``you/OctoPrint-MyNewPlugin``), e.g.:

    git commit -a -m "Initial commit of MyNewPlugin"
    git remote set-url origin git@github.com:you/OctoPrint-MyNewPlugin.git
    git push -u origin master

Congratulations, you are now the proud maintainer of a new OctoPrint plugin! :) Don't forget to add an entry to the
[wiki](https://github.com/foosel/OctoPrint/wiki#plugins) once it's suitable for general consumption, so that others
may find it!
