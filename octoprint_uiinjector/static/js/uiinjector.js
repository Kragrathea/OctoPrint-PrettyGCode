$(function () {
    console.log("Create UIInjector View Model");
    function UIInjectorViewModel(parameters) {
        var self = this;
        console.log("UIInjector View Model");


        urlParam = function (name) {
            var results = new RegExp('[\?&]' + name + '=([^&#]*)').exec(window.location.href);
            if (results == null) {
                return null;
            }
            return decodeURI(results[1]) || 0;
        }


        var focus = urlParam("focus");
        if (focus != null) {

            console.log("Focusing on:" + focus);
            $("body").children().hide();
            $("#webcam_container").hide();
            if (!focus.startsWith("."))
                focus = "#" + focus;
            var el = $(focus)[0];
            $("body").prepend(el);

        }
/*
        return;

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

*/
        //alert("UIInjector");
        //self.settings = parameters[0];

        var container;
        var camera, cameraControls, scene, renderer, loader;
        var gcodeWid = 1280 / 2;
        var gcodeHei = 960 / 2;
        var visLayer = 1;

        function loadGcode(url) {
            function animate() {

                //         var somethingVis=false;
                //         scene.traverse ( function (child) {
                //             if (child.name.startsWith("layer")
                //                 && visLayer==1
                //                  /* instanceof THREE.LineSegments*/) {
                //                 child.visible = false;
                //             }
                //             if (child.name==="layer"+visLayer){
                //                 child.visible = true;
                //                 somethingVis=true;
                //             }
                //         });
                //         //wrap
                //         if(!somethingVis
                //            //|| visLayer>30
                //           ){
                //             visLayer=1;
                //         }else
                //             visLayer++;


                const delta = clock.getDelta();
                const elapsed = clock.getElapsedTime();
                const updated = cameraControls.update(delta);
                cameraControls.dollyToCursor = true;

                renderer.render(scene, camera);
                requestAnimationFrame(animate);
            }

            var gwin = $("<div class='gwin' style='position:absolute;top:0px;width:" + gcodeWid + "px;height;" + gcodeHei + "px;opacity:0.8;z-index=5;'></div>");

            //var handle = $("<div id='handle' style='position:absolute;width:32px;height:32px;border:1px solid gray;background-color:yellow;cursor:pointer;text-align:center'></div>");
            //gwin.append(handle);

            container = $("<div class='gcode' style='display:inline-block;width:" + gcodeWid + "px;height;" + gcodeHei + "px'></div>");
            gwin.append(container);

            $("body").append(gwin);

            $('.gwin').resizable({
                resize: function (event, ui) {
                    camera.aspect = ui.size.width / ui.size.height;
                    camera.updateProjectionMatrix();
                    renderer.setSize(ui.size.width, ui.size.height);
                }
            });
            $('.gwin').draggable({
                handle: "#handle",
                appendTo: 'body',
            });

            camera = new THREE.PerspectiveCamera(60, gcodeWid / gcodeHei, 0.1, 10000);
            camera.position.set(310, 50, 0);

            CameraControls.install({ THREE: THREE });
            var clock = new THREE.Clock();
            var cameraControls = new CameraControls(camera, container[0]);

            // Mouse buttons
            cameraControls.mouseButtons = { ORBIT: THREE.MOUSE.RIGHT, /*ZOOM: THREE.MOUSE.MIDDLE,*/ PAN: THREE.MOUSE.MIDDLE };

            scene = new THREE.Scene();
            scene.background = new THREE.Color(0xe0e0e0);

            var grid = new THREE.GridHelper(2000, 40, 0x000000, 0x000000);
            grid.material.opacity = 0.2;
            grid.material.transparent = true;
            scene.add(grid);


            renderer = new THREE.WebGLRenderer();
            renderer.setPixelRatio(window.devicePixelRatio);
            renderer.setSize(gcodeWid, gcodeHei);
            container.append(renderer.domElement);

            loader = new GCodeParser();

            var object = loader.getObject();
            object.position.set(- 0, - 0, 0);
            scene.add(object);

            animate();

            var file_url = url;//'http://192.168.1.5/downloads/files/local/CCR10_Raised_Deck_Cabin.gcode';
            var myRequest = new Request(file_url);
            fetch(myRequest)
                .then(function (response) {
                    var contentLength = response.headers.get('Content-Length');
                    var myReader = response.body.getReader();
                    var decoder = new TextDecoder();
                    var buffer = '';
                    var received = 0;
                    myReader.read().then(function processResult(result) {
                        if (result.done) {
                            return;
                        }
                        received += result.value.length;
                        //                buffer += decoder.decode(result.value, {stream: true});
                        /* process the buffer string */
                        loader.parse(decoder.decode(result.value, { stream: true }));

                        // read the next piece of the stream and process the result
                        return myReader.read().then(processResult);
                    })
                })


        }


        var gwin_width = 1280;
        var gwin_height = 720;
        console.log("Start of three.js setup")
        $("body").append($("<div id='demo' style='width:500px;height:500px'></div>"))
        var createFatLineGeometry = function (opt) {

            opt = opt || {};
            opt.forPoint = opt.forPoint || function (i, per) {
                return {
                    x: i * 5,
                    y: 0,
                    z: 0
                }
            };
            opt.ptCount = opt.ptCount === undefined ? 20 : opt.ptCount;
            opt.colorSolid = opt.colorSolid === undefined ? false : opt.colorSolid;
            opt.color = opt.color === undefined ? new THREE.Color(0xffffff) : opt.color;

            // Position and Color Data
            var positions = [],
                colors = [],
                i = 0,
                point,
                geo;

            // for each point
            while (i < opt.ptCount) {

                // push point
                point = opt.forPoint(i, i / opt.ptCount);
                positions.push(point.x, point.y, point.z);

                // push color
                if (!opt.colorSolid) {
                    opt.color.setHSL(i / opt.ptCount, 1.0, 0.5);
                }
                colors.push(opt.color.r, opt.color.g, opt.color.b);

                i += 1;
            }

            // return geo
            geo = new THREE.LineGeometry();
            geo.setPositions(positions);
            geo.setColors(colors);
            return geo;

        };

        var createFatLine = function (opt) {

            opt = opt || {};
            opt.width = opt.width || 5;

            // LINE MATERIAL
            var matLine = new THREE.LineMaterial({
                linewidth: opt.width, // in pixels
                vertexColors: THREE.VertexColors
            });
            matLine.resolution.set(gwin_width, gwin_height);

            var line = new THREE.Line2(opt.geo, matLine);

            return line;

        };

        (function () {

            // RENDER
            var renderer = new THREE.WebGLRenderer({
                antialias: true
            });
            renderer.setPixelRatio(window.devicePixelRatio);
            renderer.setClearColor(0x000000, 0.0);
            renderer.setSize(gwin_width, gwin_height);
            document.getElementById('demo').appendChild(renderer.domElement);

            // SCENE
            var scene = new THREE.Scene();

            // CAMERA
            var camera = new THREE.PerspectiveCamera(40, gwin_width / gwin_height, 1, 1000);
            camera.position.set(-40, 0, 60);

            // CONTROLS
            var controls = new THREE.OrbitControls(camera, renderer.domElement);

            // CREATE FAT LINE
            var line = createFatLine({
                width: 8,
                geo: createFatLineGeometry({
                    ptCount: 80,
                    colorSolid: true,
                    color: new THREE.Color(0x00ff00),
                    forPoint: function (i, per) {
                        return {
                            x: i * 1.5,
                            y: Math.cos(Math.PI * 4 * (per)) * 10,
                            z: Math.sin(Math.PI * 4 * (per)) * 10
                        }
                    }
                })
            });

            scene.add(line);

            // CREATE ANOTHER FAT LINE
            line = createFatLine({
                width: 10,
                geo: createFatLineGeometry()
            });
            scene.add(line);

            // LOOP
            var loop = function () {

                requestAnimationFrame(loop);

                // main scene
                renderer.setClearColor(0x000000, 0);
                renderer.setViewport(0, 0, gwin_width, gwin_height);

                // renderer will set this eventually
                renderer.render(scene, camera);
                renderer.setClearColor(0x222222, 1);
                renderer.clearDepth();

            };

            loop();

        }
            ());

        console.log("End of three.js setup")

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