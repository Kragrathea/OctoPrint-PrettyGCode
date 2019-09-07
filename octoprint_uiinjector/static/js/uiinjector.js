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

        String.prototype.hashCode = function () {
            var hash = 0, i, chr;
            if (this.length === 0) return hash;
            for (i = 0; i < this.length; i++) {
                chr = this.charCodeAt(i);
                hash = ((hash << 5) - hash) + chr;
                hash |= 0; // Convert to 32bit integer
            }
            return hash;
        };

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


        //todo. parser rewrite.
        //build per "extrude" or travel. Change when extrude or type or layer changes.

        //self.settings = parameters[0];

        function GCodeParser(data) {

            var state = { x: 0, y: 0, z: 0, e: 0, f: 0, extruding: false, relative: false };
            var layers = [];

            
            var currentLayer = undefined;

            var pathMaterial = new THREE.LineBasicMaterial({ color: 0xFF0000 });
            pathMaterial.name = 'path';

            var extrudingMaterial = new THREE.LineBasicMaterial({ color: 0x0000FF });
            extrudingMaterial.name = 'extruded';
            
            var curColorHex = 'ff0000';
            var curColor = new THREE.Color('black');

            var Bucket = function (name, color) {
                this.name = name;
                this.color = color;
                this.vertexs = [];
            };

            function newLayer(line) {

                if (currentLayer !== undefined) {
                    addObject(currentLayer, true);


        //    var line = new THREE.Line2(opt.geo, matLine);



//                    if (currentLayer.curPath.length > 1) {
//                        currentLayer.paths.push(curPath);//add previous path if valid.
//                    }
                    //add tube geom.
                    //console.log(currentLayer.paths)
/*                    for (i = 0; i < currentLayer.paths.length; i++) {
                        var curve = new THREE.CatmullRomCurve3(currentLayer.paths[i]); 
                        var extrudedGeometry = new THREE.TubeBufferGeometry(curve, 1, 0.2, 2, false);

                        // Geometry doesn't do much on its own, we need to create a Mesh from it
                        var extrudedMesh = new THREE.Mesh(extrudedGeometry, new THREE.MeshPhongMaterial({ color: 0xff0000 }));
                        object.add(extrudedMesh);
                        //scene.add(extrudedMesh);
                    }
*/
                }



                currentLayer = { vertex: [], pathVertex: [], z: line.z,colors:[]};
                layers.push(currentLayer);
                console.log("layer #" + layers.length + " z:" + line.z);

                //update ui.
                $("#slider-vertical").slider("setMax", layers.length)
                $("#slider-vertical").slider("setValue", layers.length)
            }

            function addSegment(p1, p2) {
                if (currentLayer === undefined) {
                    newLayer(p1);
                }
                if (state.extruding) {
                    currentLayer.vertex.push(p1.x, p1.y, p1.z);
                    currentLayer.vertex.push(p2.x, p2.y, p2.z);
                    currentLayer.colors.push(curColor.r, curColor.g, curColor.b);
                    currentLayer.colors.push(curColor.r, curColor.g, curColor.b);
        //        }
        //        colors.push(opt.color.r, opt.color.g, opt.color.b);

                    //currentLayer.curPath = [];
                    //currentLayer.curPath.push(new THREE.Vector3(p1.x, p1.y, p1.z));
                    //currentLayer.curPath.push(new THREE.Vector3(p2.x, p2.y, p2.z))
                    //currentLayer.paths.push(currentLayer.curPath);//add previous path if valid.

                } else {
/*                    currentLayer.vertex.push(p1.x, p1.y, p1.z);
                    currentLayer.vertex.push(p2.x, p2.y, p2.z);
                    currentLayer.colors.push(curColor.r, curColor.g, curColor.b);
                    currentLayer.colors.push(curColor.r, curColor.g, curColor.b);
*/
                    //currentLayer.curPath = [];
                    //currentLayer.curPath.push(new THREE.Vector3(p1.x, p1.y, p1.z));
                    //currentLayer.curPath.push(new THREE.Vector3(p2.x, p2.y, p2.z))
                    //currentLayer.paths.push(currentLayer.curPath);//add previous path if valid.

                }

            }

            var rainbow = new THREE.Lut("rainbow", 64);
            rainbow.setMax(64);


            function addObject(layer, extruding) {

                //var geometry = new THREE.BufferGeometry();
                //geometry.addAttribute('position', new THREE.Float32BufferAttribute(vertex, 3));

                //var segments = new THREE.LineSegments(geometry, extruding ? extrudingMaterial : pathMaterial);
                //segments.name = 'layer' + layers.length;
                //object.add(segments);

        //todo path part


                if (layer.vertex.length > 2) {

                    geo = new THREE.LineGeometry();
                    geo.setPositions(layer.vertex);
                    geo.setColors(layer.colors)

                    xmatLine = new THREE.LineMaterial({
                        linewidth: 6, // in pixels
                        //color: new THREE.Color(curColorHex),// rainbow.getColor(layers.length % 64).getHex()
                        vertexColors: THREE.VertexColors,
                    });
                    xmatLine.resolution.set(gcodeWid, gcodeHei);

                    var line = new THREE.Line2(geo, xmatLine);
                    line.name = 'layer#' + layers.length;
                    object.add(line);
                }


            }
            function delta(v1, v2) {
                return state.relative ? v2 : v2 - v1;
            }

            function absolute(v1, v2) {
                return state.relative ? v1 + v2 : v2;
            }

            var previousPiece = "";
            this.parse = function (chunk) {
//                var lines = chunk.replace(/;.+/g, '').split('\n');
                var lines = chunk.split('\n');

                //handle partial lines from previous chunk.
                lines[0] = previousPiece + lines[0];
                previousPiece = lines[lines.length - 1];

                //note -1 so we dont process last line in case it is a partial.
                //Todo process the last line. Probably not needed since last line is usually gcode cleanup and not extruded lines.
                for (var i = 0; i < lines.length - 1; i++) {

                    var tokens = lines[i].split(' ');
                    var cmd = tokens[0].toUpperCase();

                    //Argumments
                    var args = {};
                    tokens.splice(1).forEach(function (token) {

                        if (token[0] !== undefined) {

                            var key = token[0].toLowerCase();
                            var value = parseFloat(token.substring(1));
                            args[key] = value;

                        }

                    });

                    //Process commands
                    //G0/G1 - Linear Movement
                    if (cmd.startsWith(";TYPE")) {
                        if (cmd.indexOf("INNER") > -1) {
                            curColor = new THREE.Color('green');

                            curColorHex = 0xff0000;
                        }
                        else if (cmd.indexOf("OUTER") > -1) {
                            curColor = new THREE.Color('blue');
                            curColorHex = 0x0000ff;
                        }
                        else if (cmd.indexOf("FILL") > -1) {
                            curColor = new THREE.Color('yellow');
                            curColorHex = 0x00ffff;
                        }
                        else if (cmd.indexOf("SKIN") > -1) {
                            curColor = new THREE.Color('red');
                            curColorHex = 0xff00ff;
                        }
                        else if (cmd.indexOf("SUPPORT") > -1) {
                            curColor = new THREE.Color('skyblue');
                            curColorHex = 0xff00ff;
                        }
                        else
                        {
                            curColorHex = (Math.abs(cmd.hashCode()) & 0xffffff);
                            curColor = new THREE.Color(curColorHex);
                        }
                        console.log(cmd + ' ' + curColorHex.toString(16))
                        //console.log(lines[i])
                    }
                    if (cmd === 'G0' || cmd === 'G1') {
                        var line = {
                            x: args.x !== undefined ? absolute(state.x, args.x) : state.x,
                            y: args.y !== undefined ? absolute(state.y, args.y) : state.y,
                            z: args.z !== undefined ? absolute(state.z, args.z) : state.z,
                            e: args.e !== undefined ? absolute(state.e, args.e) : state.e,
                            f: args.f !== undefined ? absolute(state.f, args.f) : state.f,
                        };
                        //Layer change detection is or made by watching Z, it's made by watching when we extrude at a new Z position
                        if (delta(state.e, line.e) > 0) {
                            var diff = delta(state.e, line.e);
                            line.extruding = delta(state.e, line.e) > 0;
                            if (currentLayer == undefined || line.z != currentLayer.z) {
                                newLayer(line);
                            }
                        }
                        if (cmd === 'G1')
                            addSegment(state, line);
                        state = line;
                    } else if (cmd === 'G2' || cmd === 'G3') {
                        //G2/G3 - Arc Movement ( G2 clock wise and G3 counter clock wise )
                        console.warn('THREE.GCodeLoader: Arc command not supported');
                    } else if (cmd === 'G90') {
                        //G90: Set to Absolute Positioning
                        state.relative = false;
                    } else if (cmd === 'G91') {
                        //G91: Set to state.relative Positioning
                        state.relative = true;
                    } else if (cmd === 'G92') {
                        //G92: Set Position
                        var line = state;
                        line.x = args.x !== undefined ? args.x : line.x;
                        line.y = args.y !== undefined ? args.y : line.y;
                        line.z = args.z !== undefined ? args.z : line.z;
                        line.e = args.e !== undefined ? args.e : line.e;
                        state = line;
                    } else {
                        //console.warn( 'THREE.GCodeLoader: Command not supported:' + cmd );
                    }
                }
            }


            var object = new THREE.Group();
            object.name = 'gcode';
            object.quaternion.setFromEuler(new THREE.Euler(- Math.PI / 2, 0, 0));

            this.getObject = function () {
                return object;
            }

            //    this.parse(data);

            //	return object;

        };


        var container;
        var camera, cameraControls, scene, renderer, loader,light,xmatline;
        var clock;
        var gcodeWid = 1280 ;
        var gcodeHei = 960;
        var visLayer = 1;
        var gui;



        var LayerDisplay = function () {
            this.start = 0;
            this.end = 100;
            this.displayOutline = false;
            this.explode = function () { alert(1) };
        };
        var layerDisplay = new LayerDisplay();


        function loadGcode(url) {
            function animate() {

                if (true) {
                    var somethingVis = false;
                    scene.traverse(function (child) {
                        if (child.name.startsWith("layer#")) {
                            var num = child.name.split("#")[1]
                            if (num < layerDisplay.end) {
                                child.visible = true;

                            }
                            else {
                                child.visible = false;
                            }
                        }
                    });
                }

                const delta = clock.getDelta();
                const elapsed = clock.getElapsedTime();
                const updated = cameraControls.update(delta);
                cameraControls.dollyToCursor = true;

                renderer.render(scene, camera);
                requestAnimationFrame(animate);
            }

            if ($(".gwin").length < 1) {
                var gwin = $("<div class='gwin' style='position:absolute;right:0px;bottom:0px;width:" + gcodeWid + "px;height;" + gcodeHei + "px;opacity:0.8;z-index=5;'></div>");

                var handle = $("<div id='handle' style='position:absolute;width:32px;height:32px;border:1px solid gray;background-color:yellow;cursor:pointer;text-align:center'></div>");
                gwin.append(handle);

                container = $("<div class='gcode' id='gcode' style='display:inline-block;width:" + gcodeWid + "px;height;" + gcodeHei + "px'></div>");
                gwin.append(container);
                $("body").append(gwin);


                camera = new THREE.PerspectiveCamera(60, gcodeWid / gcodeHei, 0.1, 10000);
                camera.position.set(310, 50, 0);

                CameraControls.install({ THREE: THREE });
                clock = new THREE.Clock();
                cameraControls = new CameraControls(camera, container[0]);
                cameraControls.setTarget(150, 0, -150, true);;

window.mycamera = cameraControls;


                // Mouse buttons
                cameraControls.mouseButtons = { ORBIT: THREE.MOUSE.RIGHT, /*ZOOM: THREE.MOUSE.MIDDLE,*/ PAN: THREE.MOUSE.MIDDLE };


                renderer = new THREE.WebGLRenderer();
                renderer.setPixelRatio(window.devicePixelRatio);
                renderer.setSize(gcodeWid, gcodeHei);
                container.append(renderer.domElement);

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
            }



            scene = new THREE.Scene();
            scene.background = new THREE.Color(0xe0e0e0);

            var grid = new THREE.GridHelper(2000, 40, 0x000000, 0x000000);
            grid.material.opacity = 0.2;
            grid.material.transparent = true;
            scene.add(grid);



            loader = new GCodeParser();

            var object = loader.getObject();
            object.position.set(- 0, - 0, 0);
            scene.add(object);

//////////////////////
            light = new THREE.PointLight(0xffffff);
            light.position.copy(camera.position);
            scene.add(light);


            xmatLine = new THREE.LineMaterial({
                linewidth: 6, // in pixels
                color: new THREE.Color(0xff0000)
            });
            xmatLine.resolution.set(gcodeWid, gcodeHei);

/*            gui = new dat.GUI({ autoPlace: false });

            var guielem = $("<div id='mygui' style='position:absolute;right:0px;top:0px;opacity:0.8;z-index=5;'></div>");

            $('.gwin').prepend(guielem)

            $('#mygui').prepend(gui.domElement);

            gui.add(layerDisplay, 'start', 0, 100);
            gui.add(layerDisplay, 'end', 0, 100);
            gui.add(layerDisplay, 'displayOutline');
            gui.add(layerDisplay, 'explode');
*/
            //$('.gwin').append($('<p><label for="amount">Volume:</label><input type="text" id="amount" readonly style="border:0; color:#f6931f; font-weight:bold;"></p>'));

            $('.gwin').append($('<div id="slider-vertical" style=""></div>'));

            $("#slider-vertical").slider({
                orientation: "vertical",
                reversed: true,
                range: "min",
                min: 0,
                max: 100,
                value: 100,
            }).on("slide", function (event, ui) {
                layerDisplay.end = event.value;
            });;

            //$("#slider-vertical").slider({
            //    //id: "xxgcode_layer_slider",
            //    reversed: true,
            //    selection: "after",
            //    orientation: "vertical",
            //    min: 0,
            //    max: 1,
            //    step: 1,
            //    value: 0,
            //    enabled: true,
            //    formatter: function (value) { return "Layer #" + (value + 1) ; }
            //}).on("slide", function (event, ui) {
            //    console.log(1111);
            //});

            $(".slider-vertical").attr("style", "height:80%;position:absolute;top:5%;right:30px")

            //$("#amount").val($("#slider-vertical").slider("value"));

            //geo = new THREE.LineGeometry();
            //geo.setPositions([0, 0, 0, 100, 100, 100]);
            //var line = new THREE.Line2(geo, xmatLine);
            //scene.add(line);


            //var circle = new THREE.Shape();
            //var radius = 0.2;
            //var segments = 16;
            //var theta, x, y;
            //for (var i = 0; i < segments; i++) {
            //    theta = ((i + 1) / segments) * Math.PI * 2.0;
            //    x = radius * Math.cos(theta);
            //    y = radius * Math.sin(theta);
            //    if (i == 0) {
            //        circle.moveTo(x, y);
            //    } else {
            //        circle.lineTo(x, y);
            //    }
            //}

//            var closedSpline = new THREE.CatmullRomCurve3([
//                new THREE.Vector3(- 60, - 100, 60),
//                new THREE.Vector3(- 60, 20, 60),
//                new THREE.Vector3(- 60, 120, 60),
//                new THREE.Vector3(60, 20, - 60),
//                new THREE.Vector3(60, - 100, - 60)
//            ]);
//            closedSpline.curveType = 'catmullrom';
//            closedSpline.closed = true;
//            var extrudeSettings = {
//                steps: 1,
////                amount: 50,
//                bevelEnabled: false,
//                extrudePath: closedSpline
//            };

//            //var extrudedGeometry = new THREE.ExtrudeGeometry(circle, extrudeSettings);

//            var extrudedGeometry = new THREE.TubeBufferGeometry(closedSpline, 20, 2, 8, false);

//            // Geometry doesn't do much on its own, we need to create a Mesh from it
//            var extrudedMesh = new THREE.Mesh(extrudedGeometry, new THREE.MeshPhongMaterial({ color: 0xff0000 }));
//            scene.add(extrudedMesh);



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

        var curJobName = "";
        function updateStatus() {
            $.ajax({
                url: '/api/job',
                type: 'GET',
                dataType: 'json',
                success: function (d) {
                    if (curJobName != d.job.file.path) {
                        curJobName = d.job.file.path;
                        loadGcode('http://192.168.1.5/downloads/files/local/' + curJobName);
                    }

                    //var div = $("#status");
                    //div.empty();
                    //div.append("<span>" + d.state + ":</span>");
                    //div.append("<span>" + d.job.file.display + "</span><br>");

                    //div.append("<span style='width:200px'>Done:" + Math.round(d.progress.completion) + "%</span>");


                    //div.append("<br><span>Left:" + secondsTimeSpanToHMS(d.progress.printTimeLeft) + "</span>");

                    //var currentdate = new Date();

                    //currentdate.setSeconds(currentdate.getSeconds() + d.progress.printTimeLeft);
                    //var datetime = currentdate.getHours() + ":"
                    //    + currentdate.getMinutes() + ":"
                    //    + currentdate.getSeconds();

                    //div.append("<br><span>ETA:" + datetime + "</span>");


                },
                error: function () { /*alert('boo!');*/ },
                beforeSend: function (xhr) { xhr.setRequestHeader('X-Api-Key', '74FB5A87481A4D048F0F723D7D9B7CC3'); }
            });
            //    });
        }

        setInterval(function () {
            updateStatus();
        }, 1000);


        //var gwin_width = 1280;
        //var gwin_height = 720;
        //console.log("Start of three.js setup")
        //$("body").append($("<div id='demo' style='width:500px;height:500px'></div>"))
        //var createFatLineGeometry = function (opt) {

        //    opt = opt || {};
        //    opt.forPoint = opt.forPoint || function (i, per) {
        //        return {
        //            x: i * 5,
        //            y: 0,
        //            z: 0
        //        }
        //    };
        //    opt.ptCount = opt.ptCount === undefined ? 20 : opt.ptCount;
        //    opt.colorSolid = opt.colorSolid === undefined ? false : opt.colorSolid;
        //    opt.color = opt.color === undefined ? new THREE.Color(0xffffff) : opt.color;

        //    // Position and Color Data
        //    var positions = [],
        //        colors = [],
        //        i = 0,
        //        point,
        //        geo;

        //    // for each point
        //    while (i < opt.ptCount) {

        //        // push point
        //        point = opt.forPoint(i, i / opt.ptCount);
        //        positions.push(point.x, point.y, point.z);

        //        // push color
        //        if (!opt.colorSolid) {
        //            opt.color.setHSL(i / opt.ptCount, 1.0, 0.5);
        //        }
        //        colors.push(opt.color.r, opt.color.g, opt.color.b);

        //        i += 1;
        //    }

        //    // return geo
        //    geo = new THREE.LineGeometry();
        //    geo.setPositions(positions);
        //    geo.setColors(colors);
        //    return geo;

        //};

        //var createFatLine = function (opt) {

        //    opt = opt || {};
        //    opt.width = opt.width || 5;

        //    // LINE MATERIAL
        //    var matLine = new THREE.LineMaterial({
        //        linewidth: opt.width, // in pixels
        //        vertexColors: THREE.VertexColors
        //    });
        //    matLine.resolution.set(gwin_width, gwin_height);

        //    var line = new THREE.Line2(opt.geo, matLine);

        //    return line;

        //};

        //(function () {

        //    // RENDER
        //    var renderer = new THREE.WebGLRenderer({
        //        antialias: true
        //    });
        //    renderer.setPixelRatio(window.devicePixelRatio);
        //    renderer.setClearColor(0x000000, 0.0);
        //    renderer.setSize(gwin_width, gwin_height);
        //    document.getElementById('demo').appendChild(renderer.domElement);

        //    // SCENE
        //    var scene = new THREE.Scene();

        //    // CAMERA
        //    var camera = new THREE.PerspectiveCamera(40, gwin_width / gwin_height, 1, 1000);
        //    camera.position.set(-40, 0, 60);

        //    // CONTROLS
        //    var controls = new THREE.OrbitControls(camera, renderer.domElement);

        //    // CREATE FAT LINE
        //    var line = createFatLine({
        //        width: 8,
        //        geo: createFatLineGeometry({
        //            ptCount: 80,
        //            colorSolid: true,
        //            color: new THREE.Color(0x00ff00),
        //            forPoint: function (i, per) {
        //                return {
        //                    x: i * 1.5,
        //                    y: Math.cos(Math.PI * 4 * (per)) * 10,
        //                    z: Math.sin(Math.PI * 4 * (per)) * 10
        //                }
        //            }
        //        })
        //    });

        //    scene.add(line);

        //    // CREATE ANOTHER FAT LINE
        //    line = createFatLine({
        //        width: 10,
        //        geo: createFatLineGeometry()
        //    });
        //    scene.add(line);

        //    // LOOP
        //    var loop = function () {

        //        requestAnimationFrame(loop);

        //        // main scene
        //        renderer.setClearColor(0x000000, 0);
        //        renderer.setViewport(0, 0, gwin_width, gwin_height);

        //        // renderer will set this eventually
        //        renderer.render(scene, camera);
        //        renderer.setClearColor(0x222222, 1);
        //        renderer.clearDepth();

        //    };

        //    loop();

        //}
        //    ());

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