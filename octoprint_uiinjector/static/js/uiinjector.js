$(function () {
    console.log("Create UIInjector View Model");
    function UIInjectorViewModel(parameters) {
        var self = this;
        console.log("UIInjector View Model");

        var window_states = {}
        try {
            window_states = window.JSON.parse($.cookie("window_states"));
        }
        catch (err) { }
        console.log(window_states);


        //$("#tabs_content >div")
        var width = $("#tabs_content").width();
        var height = $("#tabs_content").height();

        $("#tabs_content >div").each(function (i, el) {
            console.log(el.id)

            $(el).dialog({
                modal: false,
                //autoOpen: false,
                width: width,
                height: height,

                dragStop: function (event, ui) {
                    console.log(event.target.id);
                    $.cookie(event.target.id, window.JSON.stringify(ui.position));
                },
                open: function (event, ui) {
                    try {
                        // Restore Dialog Position
                        var cookie = $.cookie(event.target.id);
                        var pos = window.JSON.parse(cookie)
                        $(this).dialog('widget').css({ "left": pos.left, "top": pos.top });
                        $(this).dialog('option', 'title', event.target.id);
                    } catch (err) { }
                },
                close: function (event, ui) {
                    try {
                        window_states[event.target.id] = "closed";
                        $.cookie("window_states", window.JSON.stringify(window_states));
                    } catch (err) { }
                },
            }).dialog("widget").draggable("option", "containment", "none");

            if (window_states[el.id] == "closed") {
                //            $(el).dialog("close");
            }
        });


        //alert("UIInjector");
        //self.settings = parameters[0];

        //// this will hold the URL currently displayed by the iframe
        //self.currentUrl = ko.observable();

        //// this will hold the URL entered in the text field
        //self.newUrl = ko.observable();

        //// this will be called when the user clicks the "Go" button and set the iframe's URL to
        //// the entered URL
        //self.goToUrl = function () {
        //    self.currentUrl(self.newUrl());
        //};

        //// This will get called before the HelloWorldViewModel gets bound to the DOM, but after its
        //// dependencies have already been initialized. It is especially guaranteed that this method
        //// gets called _after_ the settings have been retrieved from the OctoPrint backend and thus
        //// the SettingsViewModel been properly populated.
        //self.onBeforeBinding = function () {
        //    self.newUrl(self.settings.settings.plugins.helloworld.url());
        //    self.goToUrl();
        //}
    }

    // This is how our plugin registers itself with the application, by adding some configuration
    // information to the global variable OCTOPRINT_VIEWMODELS
    OCTOPRINT_VIEWMODELS.push([
        // This is the constructor to call for instantiating the plugin
        UIInjectorViewModel,

        // This is a list of dependencies to inject into the plugin, the order which you request
        // here is the order in which the dependencies will be injected into your view model upon
        // instantiation via the parameters argument
        ["settingsViewModel"],

        // Finally, this is the list of selectors for all elements we want this view model to be bound to.
        ["#injector_link"]
    ]);
});