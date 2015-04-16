# coding=utf-8
from setuptools import setup, Command
import os

########################################################################################################################

### Do not forget to adjust the following variables to your own plugin.

# The plugin's identifier, has to be unique
plugin_identifier = "skeleton"

# The plugin's python package, should be "octoprint_<plugin identifier>", has to be unique
plugin_package = "octoprint_%s" % plugin_identifier

# The plugin's human readable name. Can be overwritten within OctoPrint's internal data via __plugin_name__ in the
# plugin module
plugin_name = "OctoPrint-PluginSkeleton"

# The plugin's version. Can be overwritten within OctoPrint's internal data via __plugin_version__ in the plugin module
plugin_version = "0.1"

# The plugin's description. Can be overwritten within OctoPrint's internal data via __plugin_description__ in the plugin
# module
plugin_description = "TODO"

# The plugin's author. Can be overwritten within OctoPrint's internal data via __plugin_author__ in the plugin module
plugin_author = "TODO"

# The plugin's author's mail address.
plugin_author_email = "todo@example.com"

# The plugin's homepage URL. Can be overwritten within OctoPrint's internal data via __plugin_url__ in the plugin module
plugin_url = "TODO"

# The plugin's license. Can be overwritten within OctoPrint's internal data via __plugin_license__ in the plugin module
plugin_license = "AGPLv3"

# Additional package data to install for this plugin. The subfolders "templates", "static" and "translations" will
# already be installed automatically if they exist.
plugin_additional_data = []

########################################################################################################################

# I18N setup
I18N_MAPPING_FILE = "babel.cfg"
I18N_DOMAIN = "messages"
I18N_INPUT_DIRS = "."
I18N_OUTPUT_DIR_PY = os.path.join(plugin_package, "translations")
I18N_OUTPUT_DIR_JS = os.path.join(plugin_package, "static", "js", "i18n")
I18N_POT_FILE = os.path.join(I18N_OUTPUT_DIR_PY, "messages.pot")

# Requirements for out application
INSTALL_REQUIRES = [
	"OctoPrint"
]

# Requirements for developing etc
EXTRA_REQUIRES = dict(
	develop=[
		# Translation dependencies
		"babel",
		"po2json"
	]
)

def package_data_dirs(source, sub_folders):
	import os
	dirs = []

	for d in sub_folders:
		folder = os.path.join(source, d)
		if not os.path.exists(folder):
			continue

		for dirname, _, files in os.walk(folder):
			dirname = os.path.relpath(dirname, source)
			for f in files:
				dirs.append(os.path.join(dirname, f))

	return dirs

def _recursively_handle_files(directory, file_matcher, folder_handler=None, file_handler=None):
	applied_handler = False

	for filename in os.listdir(directory):
		path = os.path.join(directory, filename)

		if file_handler is not None and file_matcher(filename):
			file_handler(path)
			applied_handler = True

		elif os.path.isdir(path):
			sub_applied_handler = _recursively_handle_files(path, file_matcher, folder_handler=folder_handler, file_handler=file_handler)
			if sub_applied_handler:
				applied_handler = True

			if folder_handler is not None:
				folder_handler(path, sub_applied_handler)

	return applied_handler

class CleanCommand(Command):
	description = "clean build artifacts"
	user_options = []
	boolean_options = []

	def initialize_options(self):
		pass

	def finalize_options(self):
		pass

	def run(self):
		import shutil
		import glob
		
		# build folder
		if os.path.exists('build'):
			print "Deleting build directory"
			shutil.rmtree('build')

		# eggs
		eggs = glob.glob("*.egg-info")
		for egg in eggs:
			print "Deleting %s directory" % egg
			shutil.rmtree(egg)

		# pyc files
		def delete_folder_if_empty(path, applied_handler):
			if not applied_handler:
				return
			if len(os.listdir(path)) == 0:
				shutil.rmtree(path)
				print "Deleted %s since it was empty" % path

		def delete_file(path):
			os.remove(path)
			print "Deleted %s" % path

		import fnmatch
		_recursively_handle_files(
			os.path.abspath(plugin_package),
			lambda name: fnmatch.fnmatch(name.lower(), "*.pyc"),
			folder_handler=delete_folder_if_empty,
			file_handler=delete_file
		)

		# pyc files
		def delete_folder_if_empty(path, applied_handler):
			if not applied_handler:
				return
			if len(os.listdir(path)) == 0:
				shutil.rmtree(path)
				print "Deleted %s since it was empty" % path

		def delete_file(path):
			os.remove(path)
			print "Deleted %s" % path

		import fnmatch
		_recursively_handle_files(
			os.path.abspath(plugin_package),
			lambda name: fnmatch.fnmatch(name.lower(), "*.pyc"),
			folder_handler=delete_folder_if_empty,
			file_handler=delete_file
		)
	
class NewTranslation(Command):
	description = "create a new translation"
	user_options = [
		('locale=', 'l', 'locale for the new translation'),
	]
	boolean_options = []

	def __init__(self, dist, **kw):
		from babel.messages import frontend as babel
		self.babel_init_messages = babel.init_catalog(dist)
		Command.__init__(self, dist, **kw)

	def initialize_options(self):
		self.locale = None
		self.babel_init_messages.initialize_options()

	def finalize_options(self):
		self.babel_init_messages.locale = self.locale
		self.babel_init_messages.input_file = I18N_POT_FILE
		self.babel_init_messages.output_dir = I18N_OUTPUT_DIR_PY
		self.babel_init_messages.finalize_options()

	def run(self):
		self.babel_init_messages.run()

class ExtractTranslation(Command):
	description = "extract translations"
	user_options = []
	boolean_options = []

	def __init__(self, dist, **kw):
		from babel.messages import frontend as babel
		self.babel_extract_messages = babel.extract_messages(dist)
		Command.__init__(self, dist, **kw)

	def initialize_options(self):
		self.babel_extract_messages.initialize_options()

	def finalize_options(self):
		self.babel_extract_messages.mapping_file = I18N_MAPPING_FILE
		self.babel_extract_messages.output_file = I18N_POT_FILE
		self.babel_extract_messages.input_dirs = I18N_INPUT_DIRS
		self.babel_extract_messages.msgid_bugs_address = plugin_author_email
		self.babel_extract_messages.copyright_holder = plugin_author
		self.babel_extract_messages.finalize_options()

	def run(self):
		self.babel_extract_messages.run()

class RefreshTranslation(Command):
	description = "refresh translations"
	user_options = [
		('locale=', 'l', 'locale for the translation to refresh'),
		]
	boolean_options = []

	def __init__(self, dist, **kw):
		from babel.messages import frontend as babel
		self.babel_extract_messages = babel.extract_messages(dist)
		self.babel_update_messages = babel.update_catalog(dist)
		Command.__init__(self, dist, **kw)

	def initialize_options(self):
		self.locale = None
		self.babel_extract_messages.initialize_options()
		self.babel_update_messages.initialize_options()

	def finalize_options(self):
		self.babel_extract_messages.mapping_file = I18N_MAPPING_FILE
		self.babel_extract_messages.output_file = I18N_POT_FILE
		self.babel_extract_messages.input_dirs = I18N_INPUT_DIRS
		self.babel_extract_messages.msgid_bugs_address = plugin_author_email
		self.babel_extract_messages.copyright_holder = plugin_author
		self.babel_extract_messages.finalize_options()

		self.babel_update_messages.input_file = I18N_POT_FILE
		self.babel_update_messages.output_dir = I18N_OUTPUT_DIR_PY
		self.babel_update_messages.locale = self.locale

	def run(self):
		self.babel_extract_messages.run()
		self.babel_update_messages.run()

class CompileTranslation(Command):
	description = "compile translations"
	user_options = []
	boolean_options = []

	def __init__(self, dist, **kw):
		from babel.messages import frontend as babel
		self.babel_compile_messages = babel.compile_catalog(dist)
		Command.__init__(self, dist, **kw)

	def initialize_options(self):
		self.babel_compile_messages.initialize_options()

	def finalize_options(self):
		self.babel_compile_messages.directory = I18N_OUTPUT_DIR_PY

	def run(self):
		self.babel_compile_messages.run()

		import po2json

		for lang_code in os.listdir(I18N_OUTPUT_DIR_PY):
			full_path = os.path.join(I18N_OUTPUT_DIR_PY, lang_code)

			if os.path.isdir(full_path):
				client_po_dir = os.path.join(full_path, "LC_MESSAGES")

				po2json.update_js_file(
					"%s/%s.po" % (client_po_dir, I18N_DOMAIN),
					lang_code,
					I18N_OUTPUT_DIR_JS,
					I18N_DOMAIN
				)


def params():
	# Our metadata, as defined above
	name = plugin_name
	version = plugin_version
	description = plugin_description
	author = plugin_author
	author_email = plugin_author_email
	url = plugin_url
	license = plugin_license

	# adding the new commands
	cmdclass = {
		'clean': CleanCommand,
		'babel_new': NewTranslation,
		'babel_extract': ExtractTranslation,
		'babel_refresh': RefreshTranslation,
		'babel_compile': CompileTranslation
	};
	
	# we only have our plugin package to install
	packages = [plugin_package]

	# we might have additional data files in sub folders that need to be installed too
	package_data = {plugin_package: package_data_dirs(plugin_package, ['static', 'templates', 'translations'] + plugin_additional_data)}
	include_package_data = True

	# If you have any package data that needs to be accessible on the file system, such as templates or static assets
	# this plugin is not zip_safe.
	zip_safe = False

	install_requires = INSTALL_REQUIRES
	extras_require = EXTRA_REQUIRES
	
	if os.environ.get('READTHEDOCS', None) == 'True':
		# we can't tell read the docs to please perform a pip install -e .[develop], so we help
		# it a bit here by explicitly adding the development dependencies, which include our
		# documentation dependencies
		install_requires = install_requires + extras_require['develop']

	# Hook the plugin into the "octoprint.plugin" entry point, mapping the plugin_identifier to the plugin_package.
	# That way OctoPrint will be able to find the plugin and load it.
	entry_points = {
		"octoprint.plugin": ["%s = %s" % (plugin_identifier, plugin_package)]
	}

	return locals()

setup(**params())