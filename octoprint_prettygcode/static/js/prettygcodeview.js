$(function () {

        var self = this;

        //Scene globals
        var camera, cameraControls,cameraLight; 
        var scene, renderer; 
        var gcodeProxy;//used to display loaded gcode.

        var cubeCamera;//todo make reflections optional.
        var nozzleModel;
        
        var clock;
        var sceneBounds = new THREE.Box3();
        //todo. Are these needed?
        var gcodeWid = 580;
        var gcodeHei = 580;
        var gui;

        var forceNoSync=false;//used to override sync when user drags slider. Todo. Better way to handle this?

        var currentLayerNumber=100;

        //settings that are saved between sessions
        var PGSettings = function () {
            this.showMirror=false;//default changed
            this.fatLines=true;//default changed
            this.syncToProgress=true;
            this.orbitWhenIdle=false;
            // this.reloadGcode = function () {
            //     if(gcodeProxy && curJobName!="")
            //         gcodeProxy.loadGcode('/downloads/files/local/' + curJobName);  
            //     };
            //this.showState=true;
            //this.showWebcam=false;
            //this.showFiles=false;
            //this.showDash=false;
            this.antialias=true;

            this.showNozzle=true;
            this.highlightCurrentLayer=true;
        };
        var pgSettings = new PGSettings();

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

                                

        self.initScene = function () {
            if (!viewInitialized) {
                viewInitialized = true;

                updateBedVolume();

                initThree();

                //GCode loader.
                gcodeProxy = new GCodeParser();
                var gcodeObject = gcodeProxy.getObject();
                gcodeObject.position.set(-0, -0, 0);
                scene.add(gcodeObject);

                // if(curJobName!="")
                //     gcodeProxy.loadGcode('/downloads/files/local/' + curJobName);
                    
                gcodeProxy.loadGcode('http://fluiddpi.local/server/files/gcodes/' + 'CCR10_xyzCalibration_cube.gcode?xx=1');
                    
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
            renderer = new THREE.WebGLRenderer({ canvas: document.getElementById("pgccanvas"),antialias: pgSettings.antialias });
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


            //for debugging
            window.myCameraControls = cameraControls;

            //scene
            scene = new THREE.Scene();
            scene.background = new THREE.Color(0xd0d0d0);

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
            var objloader = new THREE.OBJLoader();
            objloader.load( './js/models/ExtruderNozzle.obj', function ( obj ) {
                obj.quaternion.setFromEuler(new THREE.Euler( Math.PI / 2, 0, 0));
                obj.scale.setScalar(0.1)
                obj.position.set(0, 0, 10);
                obj.name="nozzle";
                var nozzleMaterial = new THREE.MeshStandardMaterial( {
                    metalness: 1,   // between 0 and 1
                    roughness: 0.5, // between 0 and 1
                    envMap: cubeCamera.renderTarget.texture,
                    color: new THREE.Color(0xba971b),
                    //flatShading:false,
                } );
                obj.children.forEach(function(e,i){
                    if ( e instanceof THREE.Mesh ) {
                        e.material = nozzleMaterial;
                        //e.geometry.computeVertexNormals();
                    }
                })
                nozzleModel=obj;
                scene.add( obj );
            } );
                

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

                if(printHeadSim)
                {
                    printHeadSim.updatePosition(delta);
                }
                if(curPrinterState && (curPrinterState.flags.printing || curPrinterState.flags.paused) && 
                    pgSettings.syncToProgress && (!forceNoSync))
                {
                    if(nozzleModel && printHeadSim)
                    {
                        var curState=printHeadSim.getCurPosition();
                        nozzleModel.position.copy(curState.position);
                        needRender=true;
                    }
                    if(gcodeProxy)
                    {
                        var calculatedLayer = gcodeProxy.syncGcodeObjToFilePos(curPrintFilePos);
                        if(highlightMaterial!==undefined){
                            gcodeProxy.highlightLayer(calculatedLayer,highlightMaterial);
                        }

                        $("#myslider-vertical").slider('setValue', calculatedLayer, false,true);
                        $("#myslider .slider-handle").text(calculatedLayer);

                        needRender=true;
                    }
                }else{
                    if(nozzleModel && nozzleModel.position.lengthSq()){
                        nozzleModel.position.set(0,0,0);//todo. hide instead/also?
                        needRender=true;
                    }

                    if(gcodeProxy){
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
                    nv=0.5;
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
            
            if (durJobDate != job.file.date) {
                curJobName = job.file.path;
                durJobDate = job.file.date;
                if(viewInitialized && gcodeProxy)
                    {
                        gcodeProxy.loadGcode('/downloads/files/local/' + curJobName);
                        printHeadSim=new PrintHeadSimulator();

                        //terminalGcodeProxy = new GCodeParser();
                        //terminalGcodeProxy;//used to display gcode actualy sent to printer.
                    }
            }

        }

        self.initScene();

});


