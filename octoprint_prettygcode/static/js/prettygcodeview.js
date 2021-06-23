$(function () {

        var self = this;

        //settings that are saved between sessions
        var PGSettings = function () {
            //this.showMirror=false;//default changed
            this.fatLines=true;//default changed
            this.showTravel=true;
            this.syncToProgress=true;
            this.orbitWhenIdle=false;
            this.antialias=true;
            this.lightTheme=false;
            this.saveCamera=false;

            this.showNozzle=true;
            this.highlightCurrentLayer=true;
        };
        var pgSettings = new PGSettings();
        window.PGCSettings=pgSettings;


        //Scene globals
        var camera, cameraControls,cameraLight; 
        var scene, renderer; 
        var gcodeProxy;//used to display loaded gcode.

        var cubeCamera;//todo make reflections optional.
        var nozzleModel;
        var extrudingLineGroup;
        
        var clock;
        var sceneBounds = new THREE.Box3();
        //todo. Are these needed?
        var gcodeWid = 580;
        var gcodeHei = 580;
        var gui;

        var printHeadSim=new PrintHeadSimulator();
        //var curPrinterState=null;
        var curPrintFilePos=0;
        var curSimFilePos=0;

        var forceNoSync=false;//used to override sync when user drags slider. Todo. Better way to handle this?
        
        var simPlaying =true;
        var playbackRate=1.0;

        var currentLayerNumber=0;

        $('#layer-slider').on('input', function (e) {
            if(parseInt(e.currentTarget.value))
                currentLayerNumber=parseInt(e.currentTarget.value)

            simPlaying=false;
            forceNoSync=true
            //console.log(["layerSlider",currentLayerNumber])
        });

        $('#play-button').on('click', function (e) {
            simPlaying=!simPlaying;
            forceNoSync=false
            if(!simPlaying)
                $('#play-button').html("&#x25B6;")
            else
                $('#play-button').html("&#x23F8;")

        });
        $('#faster-button').on('click', function (e) {
            playbackRate=playbackRate*2;
            if(playbackRate>64)
                playbackRate=64;
        });           
        $('#slower-button').on('click', function (e) {
            playbackRate=playbackRate/2;
            if(playbackRate<0.125)
                playbackRate=0.125;
        });           
            


        var bedVolume = undefined;
        var viewInitialized = false;

        //Watch for bed volume changes
        self.onBedVolumeChange = function(){
            //get new build volume.
            updateBedVolume();
            //update scene if any
            updateGridMesh(); 

            //Needed in case center has changed.
            resetCamera();
        }

        function connectToOctoprint()
        {
            //let jobSourcePath = 'http://octopi.local/'
            //let apiKey = '?apikey=18439BE29F904B5CA4ED388EBE085C09'

            //let jobSourcePath = 'http://fluiddpi.local:5000/'
            //let apiKey = '?apikey=666EC2F0E48C4F348375B904C9C187E5'
            let jobSourcePath = '/'
            let apiKey=''
            setInterval(function () {
                var file_url = jobSourcePath+"api/job"+apiKey;//'/downloads/files/local/xxx.gcode';
                //var file_url = "/api/job";//'/downloads/files/local/xxx.gcode';

                var myRequest = new Request(file_url,
                    {
                        method: 'GET',
                        headers: {
                            'Content-Type': 'text/plain'
                        },
                        mode: 'cors',
                        cache: 'no-cache',
                        timeout: 900 
                    }
                );
                fetch(myRequest)
                    .then(function (response) {
                        var contentLength = response.headers.get('Content-Length');
                        //console.log(response)
                        if (!response.body || !window['TextDecoder']) {
                            response.text().then(function (text) {
                                console.log(text);
                                //finishLoading();
                            });
                        } else {
                            var myReader = response.body.getReader();
                            var decoder = new TextDecoder();
                            var buffer = '';
                            var received = 0;
                            myReader.read().then(function processResult(result) {
                                if (result.done) {
                                    //finishLoading();
                                    //syncGcodeObjTo(Infinity);
                                    return;
                                }
                                received += result.value.length;
                                let rresult = decoder.decode(result.value, { stream: true });
                                let msg = JSON.parse(rresult);
                                if(msg.progress){
                                    //console.log(msg.progress.filepos)
                                    //curPrintFilePos=msg.progress.filepos
                                }
                                if(msg.state){
                                    //console.log(msg.progress.filepos)
                                    //curPrintFilePos=msg.progress.filepos
                                    $("#status-state").html(msg.state)
                                }                                
                                if(msg.job){
                                    //console.log(msg.job.file.path)
                                    if(msg.job.file.path){
                                        updateJob(jobSourcePath+'downloads/files/local/'+msg.job.file.path+apiKey);
                                        http://fluiddpi.local:5000/api/files/sdcard/CCR10_Nose106.gcode
                                        //updateJob('/downloads/files/local/'+msg.job.file.path);
                                        $("#status-name").html(msg.job.file.path)
                                    }

                                }
        
                                /* process the buffer string */
                                //parserObject.parse(decoder.decode(result.value, { stream: true }));
        
                                // read the next piece of the stream and process the result
                                return myReader.read().then(processResult);
                            })
                        }                                

                    })

            }, 1000);
            return;

            if (!("WebSocket" in window))
            {
                // The browser doesn't support WebSocket
                return;
            }
            var totalDownloaded=0;
            $.post( "http://octopi.local/api/login"+"?apikey=18439BE29F904B5CA4ED388EBE085C09", { passive:true /*,user: "chris", pass: "opib6ub9"*/ },function( data ) {
                console.log( data.session );
                //{ "auth":"chris:0CD4ED8F8EFE409C8DC204EAC2B02F03" }
                var ws = new WebSocket("ws://octopi.local/sockjs/websocket");
                ws.onopen = function()
                {
                    ws.send('{ "auth":"chris:'+data.session+'" }')
                };

                ws.onmessage = function (e) 
                { 
                    handled=false;

                    totalDownloaded+=e.data.length
                    //console.log("BytesDL:"+totalDownloaded);
                    //console.log(e.data)
                    let msg = JSON.parse(e.data);
                    //console.log(msg.current.job.file.path)
                    //console.log(msg.current.progress.filepos)
                    if(msg.current)
                    {
                        //console.log(msg.current.job.file.path)
                        let jobName=msg.current.job.file.path
                        updateJob('http:///octopi.local/downloads/files/local/' + jobName+"?apikey=18439BE29F904B5CA4ED388EBE085C09");

                        //console.log(msg.current.progress.filepos)
                        curPrintFilePos=msg.current.progress.filepos
                        handled=true;

                        console.log("BytesDL:"+totalDownloaded);
                    }

                    //if(!handled)
                    //    console.log(e.data);

                };

                ws.onclose = function()
                { 
                };

                ws.onerror = function(error){
                }
            });
                            
        }                


        function connectToMoonraker()
        {

            if ("WebSocket" in window)
            {
                var ws = new WebSocket("ws://fluiddpi.local/websocket");
                ws.onopen = function()
                {
                    ws.send('{"jsonrpc": "2.0","method": "printer.objects.query","params": {"objects": {"print_stats": null}},"id": 5434}')
                    ws.send('{"jsonrpc": "2.0","method": "printer.objects.subscribe","params": {"objects": {'+
                                '"virtual_sdcard":["file_position"],'+
                                '"print_stats":["filename"]'+
                                //'"toolhead": ["gcode_position"]'+
                            '}},"id": 5434}'
                            );
                };

                ws.onmessage = function (e) 
                { 
                    handled=false;
                    if(e.data.indexOf("notify_proc_stat_update")>-1)
                        handled=true;
                    
                    let msg = JSON.parse(e.data);
                    //console.log(msg.method)
                    if(e.data.indexOf("print_stats")>-1)
                    {    
                        //console.log(msg.params[0].virtual_sdcard.file_position);
                        if(msg.result)
                        {    if(msg.result.status.print_stats.filename)
                            {
                                let jobName=msg.result.status.print_stats.filename
                                updateJob('http://fluiddpi.local/server/files/gcodes/'+jobName);
                            }
                            //return;//handled
                        }
                        handled=true;
                    }
                    if(e.data.indexOf("virtual_sdcard")>-1)
                    {    
                        //console.log(msg.params[0].virtual_sdcard.file_position);

                        if(msg.params)
                            curPrintFilePos=msg.params[0].virtual_sdcard.file_position
                        handled=true;
                        //return;//handled
                    }

                    if(!handled)
                        console.log(e.data);
                };

                ws.onclose = function()
                { 
                };

                ws.onerror = function(error){
                }
            }

            else
            {
            // The browser doesn't support WebSocket
            }
                            
        }
                        

        function initGui()
        {
            if(true){
                //simple gui
                dat.GUI.TEXT_OPEN="View Options"
                dat.GUI.TEXT_CLOSED="View Options"
                gui = new dat.GUI({ autoPlace: false,name:"View Options",closed:false,closeOnTop:true,useLocalStorage:true });
    
                //Override default storage location to fix bug with tabs.
                //Not working
                //gui.setLocalStorageHash("PrettyGCodeSettings");

                gui.useLocalStorage=true;
                // var guielem = $("<div id='mygui' style='position:absolute;right:95px;top:20px;opacity:0.8;z-index:5;'></div>");
    
                // $('.gwin').prepend(guielem)
    
                $('#mygui').append(gui.domElement);

                gui.remember(pgSettings);
//                 gui.add(pgSettings, 'syncToProgress').onFinishChange(function(){
//                     if(pgSettings.syncToProgress){
// //                                syncLayerToZ();
//                     }
//                 });

                //gui.add(pgSettings, 'showMirror').onFinishChange(pgSettings.reloadGcode);
                gui.add(pgSettings, 'orbitWhenIdle');
                gui.add(pgSettings, 'showTravel');

                //gui.add(pgSettings, 'fatLines').onFinishChange(pgSettings.reloadGcode);
                //gui.add(pgSettings, 'reflections');
                // gui.add(pgSettings, 'antialias').onFinishChange(function(){
                //     new PNotify({
                //         title: "Reload page required",
                //         text: "Antialias chenges won't take effect until you refresh the page",
                //         type: "info"

                //         });
                //         //alert("Antialias chenges won't take effect until you refresh the page");
                //     });

                gui.add(pgSettings, 'showNozzle');
                    
                //gui.add(pgSettings, 'reloadGcode');
                gui.add(pgSettings, 'lightTheme').onFinishChange(function(){
                    if(pgSettings.lightTheme)
                        myScene.background = new THREE.Color(0xd0d0d0);
                    else
                        myScene.background = null;//new THREE.Color(0xd0d0d0);
                    
                });

                gui.add(pgSettings, 'saveCamera');

                var folder = gui.addFolder('Windows');//hidden.
                // folder.add(pgSettings, 'showState').onFinishChange(updateWindowStates).listen();
                // folder.add(pgSettings, 'showWebcam').onFinishChange(updateWindowStates).listen();
                // folder.add(pgSettings, 'showFiles').onFinishChange(updateWindowStates).listen();
                // folder.add(pgSettings, 'showDash').onFinishChange(updateWindowStates).listen();

                //dont show Windows. Automatically handled by toggle buttons
                $(folder.domElement).attr("hidden", true);

                $(".pgsettingstoggle").on("click", function () {
                    $("#mygui").toggleClass("pghidden");
                });

            } 
        }

        self.initScene = function () {
            if (!viewInitialized) {
                viewInitialized = true;

                updateBedVolume();
              
                initGui()

                initThree();

                connectToOctoprint()
                
                //GCode loader.
                // gcodeProxy = new GCodeObject2();
                // var gcodeObject = gcodeProxy.getObject();
                // gcodeObject.position.set(-0, -0, 0);
                // scene.add(gcodeObject);

                // if(curJobName!="")
                //     gcodeProxy.loadGcode('/downloads/files/local/' + curJobName);
                    
                //gcodeProxy.loadGcode('http://fluiddpi.local/server/files/gcodes/' + 'CCR10_xyzCalibration_cube.gcode?xx=1');
                //gcodeProxy.loadGcode('http://fluiddpi.local/server/files/gcodes/' + 'CCR10_3DBenchy-FAST.gcode?xx=1');


                    
            }
        };


        function resizeCanvasToDisplaySize() {
            const canvas = renderer.domElement;
            // look up the size the canvas is being displayed
            const width = canvas.clientWidth;
            const height = canvas.clientHeight;

            // adjust displayBuffer size to match
            if (canvas.width !== width || canvas.height !== height) {
                // you must pass false here or three.js sadly fights the browser
                renderer.setSize(width, height, false);
                camera.aspect = width / height;
                camera.updateProjectionMatrix();
                gcodeWid = width;
                gcodeHei = height;
                cameraControls.setViewport(0, 0, width, height);
                return true;//update needed. 
            }
            return false;//no update needed
        }

        function initThree()
        {
            renderer = new THREE.WebGLRenderer({ canvas: document.getElementById("pgccanvas"),antialias: pgSettings.antialias,alpha:true });
            //todo. is this right?
            renderer.setPixelRatio(window.devicePixelRatio);

            //todo allow save/pos camera at start.
            camera = new THREE.PerspectiveCamera(70, 2, 0.1, 10000);
            camera.up.set(0,0,1);
            camera.position.set(bedVolume.width, 0, 50);

            CameraControls.install({ THREE: THREE });
            clock = new THREE.Clock();



            var canvas = $("#pgccanvas");
            cameraControls = new CameraControls(camera, canvas[0]);



            //todo handle other than lowerleft
            resetCamera();

                        //if()
            if(pgSettings.saveCamera && localStorage.getItem('pgcCameraPos'))
            {
                var camStr=localStorage.getItem('pgcCameraPos');
                try{
                    var camPos = JSON.parse(camStr)
                    cameraControls.setPosition(camPos.pos.x,camPos.pos.y,camPos.pos.z)
                    cameraControls.setTarget(camPos.target.x,camPos.target.y,camPos.target.z)
                }catch{}
            }

            //for debugging
            window.myCameraControls = cameraControls;

            //scene
            scene = new THREE.Scene();
            if(pgSettings.lightTheme)
                scene.background = new THREE.Color(0xd0d0d0);
            else
                scene.background = null;//new THREE.Color(0xd0d0d0);

            //for debugging
            window.myScene = scene;

            //add a light. might not be needed.
            var light = new THREE.PointLight(0xffffff);
            light.position.set(0, 0,-bedVolume.height);
            scene.add(light);

            cameraLight = new THREE.PointLight(0xffffff);
            cameraLight.position.copy(camera.position);
            scene.add(cameraLight);

            //Semi-transparent plane to represent the bed. 
            updateGridMesh();

            cubeCamera = new THREE.CubeCamera( 1, 100000, 128 );
            cubeCamera.position.set(bedVolume.width/2, bedVolume.depth/2,10);
            scene.add( cubeCamera );
            cubeCamera.update( renderer, scene );

            var syncSavedZ=0;
            var cameraIdleTime=0;
            var firstFrame=true;                 /*possible bug fix. this might not be needed.*/

            //material for fatline highlighter
            var highlightMaterial = undefined;
                        
            if(pgSettings.fatLines)
            {
                highlightMaterial=new THREE.LineMaterial({
                    linewidth: 4, // in pixels
                    //transparent: true,
                    //opacity: 0.5,
                    //color: new THREE.Color(curColorHex),// rainbow.getColor(layers.length % 64).getHex()
                    vertexColors: THREE.VertexColors,
                });
                highlightMaterial.resolution.set(500, 500);
            }else{
                //highlightMaterial=
            }

            //load Nozzle model.
            // var objloader = new THREE.OBJLoader();
            // objloader.load( './js/models/ExtruderNozzle.obj', function ( obj ) {
            //     obj.quaternion.setFromEuler(new THREE.Euler( Math.PI / 2, 0, 0));
            //     obj.scale.setScalar(0.1)
            //     obj.position.set(0, 0, 10);
            //     obj.name="nozzle";
            //     var nozzleMaterial = new THREE.MeshStandardMaterial( {
            //         metalness: 1,   // between 0 and 1
            //         roughness: 0.5, // between 0 and 1
            //         envMap: cubeCamera.renderTarget.texture,
            //         color: new THREE.Color(0xba971b),
            //         //flatShading:false,
            //     } );
            //     obj.children.forEach(function(e,i){
            //         if ( e instanceof THREE.Mesh ) {
            //             e.material = nozzleMaterial;
            //             //e.geometry.computeVertexNormals();
            //         }
            //     })

                var nozzleGroup = new THREE.Group();
                //let geometry = new THREE.ConeGeometry( 5, 6, 32 );
                let geometry = new THREE.CylinderGeometry( 0.3,4.4, 3, 16 );
                //const material = new THREE.MeshBasicMaterial( {color: 0xffff00} );
                let nozzleMaterial = new THREE.MeshStandardMaterial( {
                    metalness: 1,   // between 0 and 1
                    roughness: 0.5, // between 0 and 1
                    envMap: cubeCamera.renderTarget.texture,
                    color: new THREE.Color(0xba971b),
                    //flatShading:false,
                } );
                let cone = new THREE.Mesh( geometry, nozzleMaterial );
                cone.rotation.x = -Math.PI / 2;
                cone.position.z = 1.5;

                geometry = new THREE.CylinderGeometry( 5,5, 4, 6 );
                let nutMaterial = new THREE.MeshStandardMaterial( {
                    metalness: 1,   // between 0 and 1
                    roughness: 0.5, // between 0 and 1
                    envMap: cubeCamera.renderTarget.texture,
                    color: new THREE.Color(0xba971b),
                    flatShading:true,
                } );
                let nut =new THREE.Mesh( geometry, nutMaterial );
                nut.rotation.x = -Math.PI / 2;
                nut.position.z = 5;
                

                nozzleGroup.add(cone)
                nozzleGroup.add(nut)

                extrudingLineGroup = new THREE.Group();

                geometry = new THREE.CylinderGeometry( 0.2,0.2, 1, 12 );
                let extrudingLineMaterial = new THREE.MeshStandardMaterial( {
                    //metalness: 1,   // between 0 and 1
                    //roughness: 0.5, // between 0 and 1
                    //envMap: cubeCamera.renderTarget.texture,
                    color: new THREE.Color("red"),
                    emissive:new THREE.Color("blue")
                    //flatShading:true,
                } );                
                let extrudingLine =new THREE.Mesh( geometry, extrudingLineMaterial );
                //extrudingLine.position.y = -1;
                extrudingLine.scale.y=2;
                extrudingLine.rotation.x = -Math.PI / 2;
                //extrudingLine.position.y = -10;

                extrudingLineGroup.add(extrudingLine)

                scene.add( extrudingLineGroup );

                //extrudingLine.scale.y=40;

                //extrudingLineGroup.lookAt(100,00,0)

                //extrudingLine.rotation.z= -Math.PI / 4;

                nozzleModel=nozzleGroup;
                scene.add( nozzleGroup );




            //} );
                

            function animate() {

                const delta = clock.getDelta();
                const elapsed = clock.getElapsedTime();

                var needRender = false;

                /*possible bug fix. this might not be needed.*/
                if(firstFrame)
                {
                    needRender=true;
                    firstFrame=false;
                }

                if(printHeadSim && simPlaying)
                {
                    printHeadSim.updatePosition(delta*playbackRate);

                    var curState=printHeadSim.getCurPosition();
                    if(curState.filePos)
                        curSimFilePos=curState.filePos;

                    //adapt playback rate
                    if(false){
                        var fpDelta=curPrintFilePos-curSimFilePos;
                    
                        if(fpDelta<-100)
                        {
                            playbackRate=1/(-fpDelta/100);
                            //console.log("Down throttle "+playbackRate)
                        }else if(fpDelta>100){
                            playbackRate=fpDelta/100;
                            //console.log("Up throttle "+playbackRate)
                        }else{
                            playbackRate=1;
                        }
                    }
                    //todo. stop when past end.

                    //if(playbackRate==0)
                    //    console.log(playbackRate)
                    if(playbackRate==0)
                        console.log(fpDelta)                        
                    // if(fpDelta<200)
                    //     playbackRate=0.5
                    // if(fpDelta>200)
                    //     playbackRate=fpDelta/100;

                    //console.log(fpDelta)

                }
//                if(curPrinterState && (curPrinterState.flags.printing || curPrinterState.flags.paused) && 
//                    pgSettings.syncToProgress && (!forceNoSync))
if((!forceNoSync))
                {
                    if(nozzleModel && printHeadSim)
                    {
                        var curState=printHeadSim.getCurPosition();
                        nozzleModel.position.copy(curState.position);
                        
                        //Position a cylinder to represent the segment being extruding
                        if(extrudingLineGroup && curState.startPoint)
                        {
                            if(!curState.extrude)
                                extrudingLineGroup.visible=false;
                            else{
                                extrudingLineGroup.visible=true;
                                var vectToCurEnd=nozzleModel.position.clone().sub(curState.startPoint);
                                var dist=vectToCurEnd.length();

                                extrudingLineGroup.children[0].scale.y=dist;
                                extrudingLineGroup.lookAt(curState.position);
                                extrudingLineGroup.position.copy(curState.startPoint);

                                vectToCurEnd.setLength(dist/2);
                                extrudingLineGroup.position.add(vectToCurEnd);  
                            }
                        }    
                        needRender=true;
                    }
                    if(gcodeProxy)
                    {
                        var calculatedLayer = gcodeProxy.syncGcodeObjToFilePos(curSimFilePos);
                        if(highlightMaterial!==undefined){
                            gcodeProxy.highlightLayer(calculatedLayer,highlightMaterial);
                        }

                        //$("#myslider-vertical").slider('setValue', calculatedLayer, false,true);
                        //$("#myslider .slider-handle").text(calculatedLayer);

                        needRender=true;
                    }
                }else{
                    if(nozzleModel && nozzleModel.position.lengthSq()){
                        nozzleModel.position.set(0,0,0);//todo. hide instead/also?
                        needRender=true;
                    }

                    if(gcodeProxy){
                        //todo. this should be somewhere else

                        if($('#layer-slider').attr("max")!=gcodeProxy.getLayers().length){
                            $('#layer-slider').attr("max",gcodeProxy.getLayers().length)
                            $('#layer-slider').attr("value",gcodeProxy.getLayers().length)
                            currentLayerNumber=gcodeProxy.getLayers().length;
                        }

                        if( gcodeProxy.syncGcodeObjToLayer(currentLayerNumber) )
                            {
                                if(highlightMaterial!==undefined){
                                    gcodeProxy.highlightLayer(currentLayerNumber,highlightMaterial);
                                }
                                needRender=true;
                                //console.log("GCode Proxy needs update");
                            }
                    }

                }

                //show or hide nozzle based on settings.
                if(nozzleModel && nozzleModel.visible!= pgSettings.showNozzle){
                    nozzleModel.visible= pgSettings.showNozzle;
                    needRender=true;
                }

                if(highlightMaterial!==undefined){
                    //fake a glow by ramping the diffuse color.
                    let nv = 0.5+((Math.sin(elapsed*4)+1)/4.0); 
                    nv=1.0;
                    highlightMaterial.uniforms.diffuse.value.r=nv;
                    highlightMaterial.uniforms.diffuse.value.g=nv;
                    highlightMaterial.uniforms.diffuse.value.b=nv;
                }

                cameraControls.dollyToCursor = true;//todo. needed every frame?
                const updated = cameraControls.update(delta);//handle mouse/keyboard etc.
                if(updated)//did user move the camera?
                {
                    cameraIdleTime=0;
                    needRender=true;
                                //if()
                    if(pgSettings.saveCamera)
                    {
                        let camStr= JSON.stringify({pos:cameraControls.getPosition(),target:cameraControls.getTarget()});
                        localStorage.setItem('pgcCameraPos',camStr);
                    }
                }
                else{
                    cameraIdleTime+=delta;
                    if(pgSettings.orbitWhenIdle && cameraIdleTime>5)
                    {
                        cameraControls.rotate(delta/5.0,0,false);//auto orbit camera a bit.
                        cameraControls.update(delta);//force update so it wont look like manual move next frame.
                        needRender=true;
                    }
                }

                if(cameraLight)
                {
                    cameraLight.position.copy(camera.position);
                }
                
                if(resizeCanvasToDisplaySize())
                    needRender=true;

                if(needRender)
                {
                    renderer.render(scene, camera);
                }else{
                    //console.log("idle");
                }
                requestAnimationFrame(animate);
            }

            animate();
        }

        function resetCamera() {

            if(!cameraControls)//Make sure controls exist. 
                return;

            if (bedVolume.origin == "lowerleft")
                cameraControls.setTarget(bedVolume.width / 2, bedVolume.depth / 2, 0, false);
            else
                cameraControls.setTarget(0, 0, 0, false);
        }

        function updateBedVolume() {

            //todo.
            bedVolume = {
                width: 300,
                height: 700,
                depth: 300,
                origin: "lowerleft",
                formFactor: "",//todo
            };
            return;


            //var volume = ko.mapping.toJS(self.printerProfiles.currentProfileData().volume);
            var volume = self.printerProfiles.currentProfileData().volume;
            //console.log([arguments.callee.name,volume]);

            if (typeof volume.custom_box === "function") //check for custom bounds.
            {
                bedVolume = {
                    width: volume.width(),
                    height: volume.height(),
                    depth: volume.depth(),
                    origin: volume.origin(),
                    formFactor: volume.formFactor(),
                };
            }
            else {
                //console.log(["volume.custom_box",volume.custom_box]);
                bedVolume = {
                    width: volume.custom_box.x_max() - volume.custom_box.x_min(),
                    height: volume.custom_box.z_max() - volume.custom_box.z_min(),
                    depth: volume.custom_box.y_max() - volume.custom_box.y_min(),
                    origin: volume.origin(),
                    formFactor: volume.formFactor(),
                };
            }
        }


        function updateGridMesh(){
            //console.log("updateGridMesh");
            console.log(arguments.callee.name);

            if(!scene)//scene loaded yet?
                return;

            var existingPlane = scene.getObjectByName("plane");
            if(existingPlane)
                scene.remove( existingPlane );
            var existingGrid = scene.getObjectByName("grid");
            if(existingGrid)
                scene.remove( existingGrid );
                
            //console.log([existingPlane,existingGrid]);
            
            var planeGeometry = new THREE.PlaneGeometry(bedVolume.width, bedVolume.depth);
            var planeMaterial = new THREE.MeshBasicMaterial({
            color: 0x909090,
                side: THREE.DoubleSide,
                transparent: true,
                opacity: 0.2,
            });
            var plane = new THREE.Mesh(planeGeometry, planeMaterial);
            plane.name="plane";
            //todo handle other than lowerleft
            if (bedVolume.origin == "lowerleft")
                plane.position.set(bedVolume.width / 2, bedVolume.depth / 2, -0.1);
            //plane.quaternion.setFromEuler(new THREE.Euler(- Math.PI / 2, 0, 0));
            scene.add(plane);
            //make bed sized grid. 
            var grid = new THREE.GridHelper(bedVolume.width, bedVolume.width / 10, 0x000000, 0x888888);
            grid.name="grid";
            //todo handle other than lowerleft
            if (bedVolume.origin == "lowerleft")
                grid.position.set(bedVolume.width / 2, bedVolume.depth / 2, 0);
            //if (pgSettings.transparency){
            grid.material.opacity = 0.6;
            grid.material.transparent = true;
            grid.quaternion.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
            scene.add(grid);
        }
        //currently loaded gcode
        var curJobName="";
        var durJobDate=0;//use date of file to check for update.
        
        //rename to loadGcode or something.
        function updateJob(job){
            
            // if (durJobDate != job.file.date) {
            //     curJobName = job.file.path;
            //     durJobDate = job.file.date;
            if(curJobName!=job){
                if(viewInitialized);// && gcodeProxy)
                    {
                        curJobName=job
                        //gcodeProxy.loadGcode('/downloads/files/local/' + curJobName);
                        //gcodeProxy.loadGcode('http://fluiddpi.local/server/files/gcodes/' + curJobName);

                        //remove old gcode objects
                        scene.traverse(function (child) {
                            if (child.name.startsWith("gcode")) { 
                                scene.remove(child)
                            }
                        })

                        printHeadSim=new PrintHeadSimulator();
                        gcodeProxy = printHeadSim.getGcodeObject();
                        var gcodeObject = gcodeProxy.getObject();
                        gcodeObject.position.set(-0, -0, 0);
                        scene.add(gcodeObject);

                        printHeadSim.loadGcode(curJobName);

                        //terminalGcodeProxy = new GCodeParser();
                        //terminalGcodeProxy;//used to display gcode actualy sent to printer.
                    }
            }

        }

        self.initScene();

});


