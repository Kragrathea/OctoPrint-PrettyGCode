$(function () {
    console.log("Create PrettyGCode View Model");
    function PrettyGCodeViewModel(parameters) {
        var self = this;
        self.printerProfiles = parameters[2];
        
        //Parse terminal data for file and pos updates.
        var curJobName="";
        var durJobDate=0;//use date of file to check for update. 
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
        self.fromHistoryData = function(data) {
            if(!viewInitialized)
                return;

            updateJob(data.job);
        };


        //used to animate the nozzle position in response to terminal messages
        function PrintHeadSimulator()
        {
            var buffer=[];
            var HeadState =function(){
                this.position=new THREE.Vector3(0,0,0);
                this.rate=5.0*60;
                this.extrude=false;
                this.relative=false;
                //this.lastExtrudedZ=0;//used to better calc layer number
                this.layerLineNumber=0;
                this.clone=function(){
                    var newState=new HeadState();
                    newState.position.copy(this.position);
                    newState.rate=this.rate;
                    newState.extrude=this.extrude;
                    newState.relative=this.relative;
                    //newState.lastExtrudedZ=this.lastExtrudedZ;
                    newState.layerLineNumber=this.layerLineNumber;
                    return(newState);
                }
            };
            var curState= new HeadState();
            var curEnd= new HeadState();
            var parserCurState= new HeadState();

            var observedLayerCount=0;
            var parserLayerLineNumber=0;
            var parserLastExtrudedZ=0;

            var curLastExtrudedZ=0;

            parserCurState.extrude=true;


            this.getCurPosition=function(){
                return({position:curState.position,layerZ:curLastExtrudedZ,lineNumber:curState.layerLineNumber});
            }

            //
            //var currentFileOffset=0;

            //add gcode command to the buffer
            this.addCommand= function(cmd)
            {
                //currentFileOffset+=cmd.length;
                if(buffer.length>1000)
                {
                    console.log("PrintHeadSimulator buffer overflow")
                    return;
                }
                if(cmd.indexOf(" G0")>-1 || cmd.indexOf(" G1")>-1)
                {
                    var x= parseFloat(cmd.split("X")[1])
                    if(!Number.isNaN(x))
                    {
                        if(parserCurState.relative)
                           parserCurState.position.x+=x;
                        else
                           parserCurState.position.x=x;
                    }
                    var y= parseFloat(cmd.split("Y")[1])
                    if(!Number.isNaN(y))
                    {
                        if(parserCurState.relative)
                           parserCurState.position.y+=y;
                        else
                           parserCurState.position.y=y;
                    }
                    var z= parseFloat(cmd.split("Z")[1])
                    if(!Number.isNaN(z))
                    {
                        if(parserCurState.relative)
                           parserCurState.position.z+=z;
                        else
                           parserCurState.position.z=z;
                    }
                    var f= parseFloat(cmd.split("F")[1])
                    if(!Number.isNaN(f))
                    {
                        parserCurState.rate=f;
                    }
                    var e= parseFloat(cmd.split("E")[1])
                    if(!Number.isNaN(e))
                    {
                        parserCurState.extrude=true;
                        if( parserLastExtrudedZ!=parserCurState.position.z)
                        {
                            //new layer (probably)
                            //observedLayerCount++
                            //console.log("New layer Z."+parserCurState.position.z+" File offset:"+currentFileOffset)
                            parserLayerLineNumber=0;
                            parserLastExtrudedZ=parserCurState.position.z;
                        }
                        else
                            parserLayerLineNumber++;
                    }else{
                        parserCurState.extrude=false;
                    }

                    parserCurState.layerLineNumber =parserLayerLineNumber;
                    
                    buffer.push(parserCurState.clone());
 
                } else if (cmd.indexOf(" G90")>-1) {
                    //G90: Set to Absolute Positioning
                    parserCurState.relative = false;
                } else if (cmd.indexOf(" G91")>-1) {
                    //G91: Set to state.relative Positioning
                    parserCurState.relative = true;
                }
                
            }
//window.myMaxRate=120.0; 
//window.fudge=7; 

            //Update the printhead position based on time elapsed.
            this.updatePosition=function(timeStep){

                //Convert the gcode feed rate (in MM/per min?) to rate per second.
                var rate = curState.rate/60.0;

        //rate=rate/2;//todo. why still too fast?

                //adapt rate to keep up with buffer.
                //todo. Make dist based rather than just buffer size.
                if(buffer.length>10)
                {
                    rate=rate*(buffer.length/5.0);
                    //console.log(["Too Slow ",rate,buffer.length])
                }
                if(buffer.length<5)
                {
                    rate=rate*(1.0/(buffer.length*5.0));
                    //console.log(["Too fast ",rate,buffer.length])
                }
//rate=Math.min(rate,window.myMaxRate);
                //dist head needs to travel this frame
                var dist = rate*timeStep
                while(buffer.length>0 && dist >0)//while some place to go and some dist left.
                {
                    //direction
                    var vectToCurEnd=curEnd.position.clone().sub(curState.position);
                    var distToEnd=vectToCurEnd.length();
                    if(dist<distToEnd)//Inside current line?
                    {
                        //move pos the distance along line
                        vectToCurEnd.setLength(dist);
                        curState.position.add(vectToCurEnd);  
                        dist=0;//all done 
                    }else{
                        //move pos to end point.
                        curState.position.copy(curEnd.position);
                        curState.rate=curEnd.rate;
                        //subract dist for next loop.
                        dist=dist-distToEnd;

                        //draw segment
                        //todo.

                        //update lastZ for display of layers. 
                        if(curEnd.extrude && curEnd.position.z != curLastExtrudedZ )
                        {
                            curLastExtrudedZ=curEnd.position.z;
                        }
                        //console.log([curState.position.z,curState.layerLineNumber])

                        //start on next buffer command
                        buffer.shift();
                        if(buffer.length>0)
                        {
                            curEnd=buffer[0];
                            curState.layerLineNumber=curEnd.layerLineNumber;
                        }
                    }
                }
            }
        }

        var printHeadSim=new PrintHeadSimulator();
        var curPrinterState=null;
        var curPrintFilePos=0;
        self.fromCurrentData= function (data) {

            //Dont do anything if view not initalized
            if(!viewInitialized)
                return;

            //update current loaded model.
            updateJob(data.job);
            if(curPrinterState && curPrinterState.text!=data.state.text)
            {
                //console.log(["Printer state changed: ",curPrinterState.text," -> ",data.state.text])
                if(data.state.text.startsWith("Operational"))
                {
                    //console.log("Resetting print simulation");
                    printHeadSim=new PrintHeadSimulator();
                }
            }
            curPrinterState=data.state;


            curPrintFilePos=data.progress.filepos;

            //parse logs position data for simulator
            if(data.logs.length){
                data.logs.forEach(function(e,i)
                {
                    if(e.startsWith("Send:"))
                    {
                        //console.log(["GCmd:",e]);
                        if(printHeadSim)
                            printHeadSim.addCommand(e);

                        //Strip out the extra stuff in the terminal line.
                        //match second space to * character. I hate regexp.
                        if(terminalGcodeProxy){
                             var reg=new RegExp('(?<=\\s\\S*\\s).[^*]*','g');
                             var matches=e.match(reg);
                             if(matches && matches.length>0)
                                 terminalGcodeProxy.parse(matches[0]+'\n');
                        }
                    }
                })
            }
        };

        self.updateCss = function (newCss)
        {
            //alert(this)
            var newCss=$("#pg_add_css").val();
            console.log(["Update css:",newCss]);
            localStorage.setItem('pg_add_css_val',newCss)
            $("#pgcss").html(newCss);

        }
        self.onAfterBinding = function () {
            console.log("onAfterBinding")

            //var addCss=$("#add_css").val();
            $("<style id='pgcss'>")
            .prop("type", "text/css")
            .html("")
            .appendTo("head");

            var css = localStorage.getItem('pg_add_css_val')
            if(css){
                $("#pgcss").html(css);
                $("#pg_add_css").val(css);
            }
    };
        self.onEventFileSelected = function (payload){
            //console.log(["onEventFileSelected ",payload])
        }

        //Scene globals
        var camera, cameraControls,cameraLight; 
        var scene, renderer; 
        var gcodeProxy;//used to display loaded gcode.
        var terminalGcodeProxy;//used to display gcode actualy sent to printer.
        var cubeCamera;
        var nozzleModel;
        var clock;
        var dimensionsGroup;
        var sceneBounds = new THREE.Box3();
        //todo. Are these needed?
        var gcodeWid = 580;
        var gcodeHei = 580;
        var gui;

        var forceNoSync=false;//used to override sync when user drags slider. Todo. Better way to handle this?

        var currentLayerNumber=0;

        //settings that are saved between sessions
        var PGSettings = function () {
            this.showMirror=false;//default changed
            this.fatLines=true;//default changed
            //this.reflections=false;//remove this
            this.syncToProgress=true;
            this.orbitWhenIdle=false;
            this.reloadGcode = function () {
                if(gcodeProxy && curJobName!="")
                    gcodeProxy.loadGcode('/downloads/files/local/' + curJobName);  
                };
            this.showState=true;
            this.showWebcam=false;
            this.showFiles=false;
            this.showDash=false;
            this.antialias=true;

            this.showNozzle=true;
            this.highlightCurrentLayer=true;
        };
        var pgSettings = new PGSettings();

        function updateWindowStates() {
            if (pgSettings.showState) {
                $("#state_wrapper").removeClass("pghidden");
            }
            else {
                $("#state_wrapper").addClass("pghidden");
            }
            if (pgSettings.showFiles) {
                $("#files_wrapper").removeClass("pghidden");
            }
            else {
                $("#files_wrapper").addClass("pghidden");
            }
            if (pgSettings.showWebcam) {
                $(".gwin #webcam_rotator").removeClass("pghidden");
            }
            else {
                $(".gwin #webcam_rotator").addClass("pghidden");
            }
            if (pgSettings.showDash) {
                $("#tab_plugin_dashboard").removeClass("pghidden");
            }
            else {
                $("#tab_plugin_dashboard").addClass("pghidden");
            }
        }


        var bedVolume = undefined;
        var viewInitialized = false;
        self.onTabChange = function (current, previous) {

            if (current == "#tab_plugin_prettygcode") {
                if (!viewInitialized) {
                    viewInitialized = true;

                    //Watch for bed volume changes
                    self.printerProfiles.currentProfileData.subscribe(
                        function(){
                            //get new build volume.
                            updateBedVolume();
                            //update scene if any
                            updateGridMesh(); 

                            //Needed in case center has changed.
                            resetCamera();
                        });


                    //get current (possibly default) printer build volume.
                    updateBedVolume();

                    //console.log(["bedVolume",bedVolume]);

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
                        gui.add(pgSettings, 'syncToProgress').onFinishChange(function(){
                            if(pgSettings.syncToProgress){
//                                syncLayerToZ();
                            }
                        });

                        gui.add(pgSettings, 'showMirror').onFinishChange(pgSettings.reloadGcode);
                        gui.add(pgSettings, 'orbitWhenIdle');
                        gui.add(pgSettings, 'fatLines').onFinishChange(pgSettings.reloadGcode);
                        //gui.add(pgSettings, 'reflections');
                        gui.add(pgSettings, 'antialias').onFinishChange(function(){
                            new PNotify({
                                title: "Reload page required",
                                text: "Antialias chenges won't take effect until you refresh the page",
                                type: "info"

                                });
                                //alert("Antialias chenges won't take effect until you refresh the page");
                            });

                        gui.add(pgSettings, 'showNozzle');
                            
                        //gui.add(pgSettings, 'reloadGcode');
                      
                        var folder = gui.addFolder('Windows');//hidden.
                        folder.add(pgSettings, 'showState').onFinishChange(updateWindowStates).listen();
                        folder.add(pgSettings, 'showWebcam').onFinishChange(updateWindowStates).listen();
                        folder.add(pgSettings, 'showFiles').onFinishChange(updateWindowStates).listen();
                        folder.add(pgSettings, 'showDash').onFinishChange(updateWindowStates).listen();

                        //dont show Windows. Automatically handled by toggle buttons
                        $(folder.domElement).attr("hidden", true);

                    } 

                    initThree();

                    //load Nozzle model.
                    var objloader = new THREE.OBJLoader();
                    objloader.load( '/plugin/prettygcode/static/js/models/ExtruderNozzle.obj', function ( obj ) {
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

                    //GCode loader.
                    gcodeProxy = new GCodeParser();
                    var gcodeObject = gcodeProxy.getObject();
                    gcodeObject.position.set(-0, -0, 0);
                    scene.add(gcodeObject);

                    if(curJobName!="")
                        gcodeProxy.loadGcode('/downloads/files/local/' + curJobName);

                    if(false){
                        //terminal parser
                        terminalGcodeProxy = new GCodeParser();
                        terminalGcodeProxy.addSegment= function(p1, p2) {
                            //console.log(["addSegment",p1,p2])
                            if (currentLayer === undefined) {
                                newLayer(p1);
                            }
                        }
                        var terminalGcodeObject = terminalGcodeProxy.getObject();
                        terminalGcodeObject.position.set(100, -0, 0);
                        scene.add(terminalGcodeObject);
                    }
       
                    //note this is an octoprint version of a bootstrap slider. not a jquery ui slider. 
                    $('.gwin').append($('<div id="myslider-vertical" style=""></div>'));
                    $("#myslider-vertical").slider({
                        id: "myslider",
                        orientation: "vertical",
                        reversed: true,
                        range: "min",
                        min: 0,
                        max: 100,
                        value: 100,
                    }).on("slide", function (event, ui) {
                        currentLayerNumber = event.value;
                        $("#myslider .slider-handle").text(currentLayerNumber);
                    }).on("slideStart", function (event, ui) {
                        //console.log("slideStart");
                        forceNoSync=true;
                    }).on("slideStop", function (event, ui) {
                        //console.log("slideStop");
                        forceNoSync=false;
                    });
                    $("#myslider").attr("style", "height:90%;position:absolute;top:5%;right:20px")


                    //Create a web camera inset for the view. 
                    var camView = $("#webcam_rotator").clone();
                    $(".gwin").append(camView)

                    //check url for fullscreen mode
                    if (urlParam("fullscreen"))
                        $(".page-container").addClass("pgfullscreen");

                    //setup window toggle buttons
                    $(".fstoggle").on("click", function () {
                        $(".page-container").toggleClass("pgfullscreen");
                    });
                    $(".pgsettingstoggle").on("click", function () {
                        $("#mygui").toggleClass("pghidden");
                    });
                    $(".pgstatetoggle").on("click", function () {
                        pgSettings.showState=!pgSettings.showState;
                        updateWindowStates();
                    });
                    $(".pgfilestoggle").on("click", function () {
                        pgSettings.showFiles=!pgSettings.showFiles;
                        updateWindowStates();
                    });
                    $(".pgcameratoggle").on("click", function () {
                        pgSettings.showWebcam=!pgSettings.showWebcam;
                        updateWindowStates();
                    }); 
                    $(".pgdashtoggle").on("click", function () {
                        pgSettings.showDash=!pgSettings.showDash;;
                        updateWindowStates();
                    });                                         
                    updateWindowStates();
                }

                //Activate webcam view in window. 
                $(".gwin #webcam_image").attr("src", "/webcam/?action=stream&" + Math.random())

            } else if (previous == "#tab_plugin_prettygcode") {
                //todo. disable animation 
                
                //Disable camera when tab isnt visible.
                $(".gwin #webcam_image").attr("src", "")
            }
        };

        //util function
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

        //util function
        urlParam = function (name) {
            var results = new RegExp('[\?&]' + name + '=([^&#]*)').exec(window.location.href);
            if (results == null) {
                return null;
            }
            return decodeURI(results[1]) || 0;
        }

        //Handle "focus" url param. Not used anymore.
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

        function updateBedVolume() {

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

        function GCodeParser(data) {

            var state = { x: 0, y: 0, z: 0, e: 0, f: 0, extruding: false, relative: false };
            var layers = [];
            
            var currentLayer = undefined;

            var defaultColor = new THREE.Color('white');
            var curColor = defaultColor;
            var filePos=0;//used for syncing when printing.

            var previousPiece = "";//used for parsing gcode in chunks.

            //material for fatlines
            var curMaterial = new THREE.LineMaterial({
                linewidth: 3, // in pixels
                //transparent: true,
                //opacity: 0.5,
                //color: new THREE.Color(curColorHex),// rainbow.getColor(layers.length % 64).getHex()
                vertexColors: THREE.VertexColors,
            });
            //todo. handle window resize
//            curMaterial.resolution.set(gcodeWid, gcodeHei);
            curMaterial.resolution.set(500, 500);

            //for plain lines
            var curLineBasicMaterial = new THREE.LineBasicMaterial( {
                color: 0xffffff,
                vertexColors: THREE.VertexColors
            } );

            var gcodeGroup = new THREE.Group();
            gcodeGroup.name = 'gcode';

            //reset parser for another object.
            this.reset=function()
            {
                this.clearObject();
                state = { x: 0, y: 0, z: 0, e: 0, f: 0, extruding: false, relative: false };
                layers = [];
                currentLayer = undefined;
                curColor = defaultColor;
                filePos=0;
                previousPiece = "";
            }
            this.getObject = function () {
                return gcodeGroup;
            }
           
            this.clearObject= function () {
                if(gcodeGroup){
                    for (var i = gcodeGroup.children.length - 1; i >= 0; i--) {
                        gcodeGroup.remove(gcodeGroup.children[i]);
                    }            
                }
            }
            easeOutBounce= function (t, b, c, d) {  
                if ((t/=d) < (1/2.75)) {  
                 return c*(7.5625*t*t) + b;  
                } else if (t < (2/2.75)) {  
                 return c*(7.5625*(t-=(1.5/2.75))*t + .75) + b;  
                } else if (t < (2.5/2.75)) {  
                 return c*(7.5625*(t-=(2.25/2.75))*t + .9375) + b;  
                } else {  
                 return c*(7.5625*(t-=(2.625/2.75))*t + .984375) + b;  
                }  
               }
            easeInBounce = function (t, b, c, d) {
                return c - easeOutBounce (d-t, 0, c, d) + b;
            };
            easeOutExpo= function (t, b, c, d) {
                return (t==d) ? b+c : c * (-Math.pow(2, -10 * t/d) + 1) + b;
            }
            easeOutFall= function (t, b, c, d) {
                var dist = 0.5*9.8*(t*t)
                var per = (dist+b)
                return dist;
            }
            this.animateLayers=function(curTime,deltaTime)
            {
                if(true){
                    var startZ=100;
                    gcodeGroup.traverse(function (child) {
                        if (child.name.startsWith("layer#")) {
                            var udata=child.userData;

                            var dist=(2.0-(curTime/2))*100.0;

                            var newZ = Math.max(0,udata.layerNumber*dist);
                            child.position.set(0,0,newZ);


                            // var startTime = udata.layerNumber/8.0;
                            // if(curTime>=startTime)
                            // {
                            //     var myTime = curTime-startTime;
                            //     var dist = 9.8*(myTime*myTime)
                            //     var newZ = Math.max(0,startZ-dist);
                            //     child.position.set(0,0,newZ);
                            // }
                            // else{
                            //     child.position.set(0,0,startZ);
                            // }
                        }
                    });
                }else{
                    gcodeGroup.traverse(function (child) {
                        if (child.name.startsWith("layer#")) {
                            var udata=child.userData;
                            var endTime = udata.layerNumber/4.0;
                            if(curTime<endTime)
                            {
                                var z=easeOutExpo(curTime,0,100,endTime);
                            //Math.sin(curTime+(udata.layerNumber*0.1))
                                child.position.set(0,0,100-z);
                            }
                            else
                                child.position.set(0,0,0);
                        }
                    });
                    
                }
            }
            this.highlightLayer=function (layerNumber,highlightMaterial)
            {
                var needUpdate=false;//only need update if visiblity changes
                var defaultMat=curLineBasicMaterial;
                if(pgSettings.fatLines){
                    defaultMat=curMaterial;
                }

                gcodeGroup.traverse(function (child) {
                    if (child.name.startsWith("layer#")) {
                        if (child.userData.layerNumber<layerNumber) {
                            if(child.material.uuid!=defaultMat.uuid)
                            {
                                child.material=defaultMat;
                                needUpdate=true;
                            }
                        }else if (child.userData.layerNumber==layerNumber) {
                            if(child.material.uuid!=highlightMaterial.uuid)
                            {
                                child.material=highlightMaterial;
                                needUpdate=true;
                            }
                        }
                        else {
                            if(child.material.uuid!=defaultMat.uuid)
                            {
                                child.material=defaultMat;
                                needUpdate=true;
                            }
                        }
                    }
                });
                return(needUpdate);
            }

            this.syncGcodeObjToLayer=function (layerNumber,lineNumber=Infinity)
            {
                var needUpdate=false;//only need update if visiblity changes

                //hack comp for mirror.
                //todo. better handle of mirror object so this isnt needed. 
                if(pgSettings.showMirror && lineNumber!=Infinity)
                    lineNumber=lineNumber*2;

                gcodeGroup.traverse(function (child) {
                    if (child.name.startsWith("layer#")) {
                        if (child.userData.layerNumber<layerNumber) {

                            if(!child.visible || child.geometry.maxInstancedCount!=child.userData.numLines)
                                needUpdate = true;

                            child.visible = true;
                            child.geometry.maxInstancedCount=child.userData.numLines;
                        }else if (child.userData.layerNumber==layerNumber) {
                            if(!child.visible || child.geometry.maxInstancedCount!=Math.min(lineNumber,child.userData.numLines))
                                needUpdate = true;

                            child.visible = true;
                            child.geometry.maxInstancedCount=Math.min(lineNumber,child.userData.numLines);
                        }
                        else {
                            if(child.visible)
                                needUpdate = true;

                            child.visible = false;
                        }
                    }
                });
                return(needUpdate);
            }
            this.syncGcodeObjTo=function (layerZ,lineNumber=Infinity)
            {
                //hack comp for mirror.
                //todo. better handle of mirror object so this isnt needed. 
                if(pgSettings.showMirror && lineNumber!=Infinity)
                    lineNumber=lineNumber*2;

                gcodeGroup.traverse(function (child) {
                    if (child.name.startsWith("layer#")) {
                        if (child.userData.layerZ<layerZ) {
                            child.visible = true;

                            child.geometry.maxInstancedCount=child.userData.numLines;
                        }else if (child.userData.layerZ==layerZ) {
                            child.visible = true;
                            child.geometry.maxInstancedCount=Math.min(lineNumber,child.userData.numLines);
                        }
                        else {
                            child.visible = false;
                        }
                    }
                });
            }
            this.syncGcodeObjToFilePos=function (filePosition)
            {
                let syncLayerNumber = 0;//derived layer number based on pos and user data.
                gcodeGroup.traverse(function (child) {
                    if (child.name.startsWith("layer#")) {
                        var filePositions=child.userData.filePositions;
                        var fpMin=filePositions[0];
                        var fpMax = filePositions[filePositions.length];
                        if (fpMax<filePosition) { //way before.
                            child.visible = true;

                            child.geometry.maxInstancedCount=child.userData.numLines;
                        }else if (fpMin>filePosition) { //way after
                            child.visible = false;
                        }else //must be during. right?
                        {
                            child.visible = true;

                            //count number of lines before filePos
                            var count =0;
                            while(count<filePositions.length && filePositions[count]<filePosition)
                                count++;
                            
                            //hack comp for mirror.
                            //todo. better handle of mirror object so this isnt needed. 
                            if(pgSettings.showMirror)
                                count=count*2;

                            child.geometry.maxInstancedCount=Math.min(count,child.userData.numLines);

                            syncLayerNumber = child.userData.layerNumber
                        }
                    }
                });
                return syncLayerNumber;//used to sync other elements.
            }
            this.currentUrl="";
            this.loadGcode=function(url) {
                this.reset();

                currentUrl=url;

                var parserObject=this;
                var file_url = url;//'/downloads/files/local/xxx.gcode';
                var myRequest = new Request(file_url);
                fetch(myRequest)
                    .then(function (response) {
                        var contentLength = response.headers.get('Content-Length');
                        if (!response.body || !window['TextDecoder']) {
                            response.text().then(function (text) {
                                parserObject.parse(text);
                                parserObject.finishLoading();
                            });
                        } else {
                            var myReader = response.body.getReader();
                            var decoder = new TextDecoder();
                            var buffer = '';
                            var received = 0;
                            myReader.read().then(function processResult(result) {
                                if (result.done) {
                                    parserObject.finishLoading();
                                    return;
                                }
                                received += result.value.length;
                                //                buffer += decoder.decode(result.value, {stream: true});
                                /* process the buffer string */
                                parserObject.parse(decoder.decode(result.value, { stream: true }));
    
                                // read the next piece of the stream and process the result
                                return myReader.read().then(processResult);
                            })
                        }
                    })
    
            }
            this.finishLoading=function()
            {
                if (currentLayer !== undefined) {
                    addObject(currentLayer, true);
                }

                //update scene bounds.
                var bsize=new THREE.Vector3();
                sceneBounds.getSize(bsize);

                //update ui slider
                if ($("#myslider-vertical").length) {
                    $("#myslider-vertical").slider("setMax", layers.length)
                    $("#myslider-vertical").slider("setValue", layers.length,false,true)
                    $("#myslider .slider-handle").text(layers.length);

                    currentLayerNumber = layers.length;
                }

                console.log("Finished loading GCode object.")
                console.log(["layers:",layers.length,"size:",filePos])
                //console.log([sceneBounds,layers])
                
                //gcodeProxy.syncGcodeObjTo(Infinity);

                //updateDimensions(bsize); 
                 
                //Move zoom camera to new bounds.
                var dist = Math.max(Math.abs(bsize.x), Math.abs(bsize.y)) / 2;
                dist=Math.max(20,dist);//min distance to model.
                //console.log(dist)
                cameraControls.dollyTo(dist * 2.0 ,true);
            }

            function addObject(layer, extruding) {

                if (layer.vertex.length > 2) { //Something to draw?
                    if(pgSettings.fatLines){//fancy lines
                        var geo = new THREE.LineGeometry();
                        geo.setPositions(layer.vertex);
                        geo.setColors(layer.colors)
                        var line = new THREE.Line2(geo, curMaterial);
                        line.name = 'layer#' + layers.length;
                        line.userData={layerZ:layer.z,layerNumber:layers.length,numLines:layer.vertex.length/6,filePositions:layer.filePositions};// 6 because 2 x triplets
                        gcodeGroup.add(line);
                        //line.renderOrder = 2;
                    }else{//plain lines
                        var geo = new THREE.BufferGeometry();
                        geo.addAttribute( 'position', new THREE.BufferAttribute( new Float32Array(layer.vertex), 3 ) );
                        geo.addAttribute( 'color', new THREE.BufferAttribute( new Float32Array(layer.colors), 3 ) );
                        var line = new THREE.LineSegments( geo, curLineBasicMaterial );
                        line.name = 'layer#' + layers.length;
                        line.userData={layerZ:layer.z,layerNumber:layers.length,numLines:layer.vertex.length/6,filePositions:layer.filePositions};
                        gcodeGroup.add(line);

                    }
                }
            }

            function newLayer(line) {
                if (currentLayer !== undefined) {
                    addObject(currentLayer, true);
                }

                currentLayer = { vertex: [], pathVertex: [], z: line.z, colors: [], filePositions:[] };
                layers.push(currentLayer);
                //console.log("layer #" + layers.length + " z:" + line.z);

            }
            /*this.addArc= function (arc, material ) {
                // let geometry = new THREE.Geometry();
        
                // let start  = new THREE.Vector3(arc.x1, arc.y1, arc.z1);
                // let center = new THREE.Vector3(arc.i,  arc.j,  arc.k);
                // let end    = new THREE.Vector3(arc.x2, arc.y2, arc.z2);
        
                let radius = Math.sqrt(
                    Math.pow((arc.x1 - arc.i), 2) + Math.pow((arc.y1 - arc.j), 2)
                );
                let arcCurve = new THREE.ArcCurve(
                    arc.i, // aX
                    arc.j, // aY
                    radius, // aRadius
                    Math.atan2(arc.y1 - arc.j, arc.x1 - arc.i), // aStartAngle
                    Math.atan2(arc.y2 - arc.j, arc.x2 - arc.i), // aEndAngle
                    !!arc.isClockwise // isClockwise
                );
                let divisions = 10;
                let vertices = arcCurve.getPoints(divisions);
                let vectorthrees = [];
                for (var i = 0; i < vertices.length; i++) {
                    vectorthrees.push(new THREE.Vector3(vertices[i].x, vertices[i].y, arc.z1));
                }
                if (vectorthrees.length) {
                    let geometry = new THREE.Geometry();
                    geometry.vertices = vectorthrees;
                    object.add(new THREE.Line(geometry, material));
                }
            }*/
            this.addSegment= function(p1, p2) {
                if (currentLayer === undefined) {
                    newLayer(p1);
                }
                if(Number.isNaN(p1.x) ||Number.isNaN(p1.y) ||Number.isNaN(p1.z) ||Number.isNaN(p2.x) ||Number.isNaN(p2.y) ||Number.isNaN(p2.z))
                {
                    console.log(["Bad line segment",p1,p2]);
                    return;
                }

                currentLayer.vertex.push(p1.x, p1.y, p1.z);
                currentLayer.vertex.push(p2.x, p2.y, p2.z);
                currentLayer.filePositions.push(filePos);//save for syncing.

                if (curColor != defaultColor) {
                    sceneBounds.expandByPoint(p1);
                    sceneBounds.expandByPoint(p2);
                }

                if(pgSettings.showMirror){
                        //add mirror version
                    currentLayer.vertex.push(p1.x, p1.y, -p1.z);
                    currentLayer.vertex.push(p2.x, p2.y, -p2.z);
                }

                if (true)//faux shading. Darken line color based on angle
                {
                    //var p1=new THREE.Vector3(10,10,0);
                    //var p2=new THREE.Vector3(15,15,0);

                    var per=1.0;//bright
                    if(true)
                    {
                        //var np2=new THREE.Vector3(p2.x,p2.y,p2.z);
                        var vec = new THREE.Vector3(p2.x-p1.x,p2.y-p1.y,p2.z-p1.z);
                        vec.normalize();
//                        per= Math.max(vec.dot(new THREE.Vector3(1,0,0)),0.0)
//                        per= Math.abs(vec.dot(new THREE.Vector3(1,0,0)),0.0)
                        per = (vec.dot(new THREE.Vector3(1,0,0))/2)+0.5;
                        per=(per/5.0);
                    }else{
                        var deltaX = p2.x - p1.x;
                        var deltaY = p2.y - p1.y;
                        var rad = Math.atan2(deltaY, deltaX);

                        rad = Math.abs(rad)
                        per = (rad) / (2.0 * 3.1415);
                    //console.log(rad + " " + per);
                    }
                    var drawColor = new THREE.Color(curColor)
                    var hsl = {}
                    drawColor.getHSL(hsl);

                    //darken every other line to make the layers easier to see.
                    if((layers.length%2)==0)
                        hsl.l = per+0.25;
                    else
                        hsl.l = per+0.30;

                    drawColor.setHSL(hsl.h,hsl.s,hsl.l);
                    //console.log(drawColor.r + " " + drawColor.g + " " + drawColor.b )
                    currentLayer.colors.push(drawColor.r, drawColor.g, drawColor.b);
                    currentLayer.colors.push(drawColor.r, drawColor.g, drawColor.b);

                    if(pgSettings.showMirror){
                        //add mirror version
                        drawColor.setHSL(hsl.h, hsl.s, hsl.l/2);
                        currentLayer.colors.push(drawColor.r, drawColor.g, drawColor.b);
                        currentLayer.colors.push(drawColor.r, drawColor.g, drawColor.b);
                    }
                }
                else {
                    currentLayer.colors.push(curColor.r, curColor.g, curColor.b);
                    currentLayer.colors.push(curColor.r, curColor.g, curColor.b);
                }
            }

            function delta(v1, v2) {
                return state.relative ? v2 : v2 - v1;
            }

            function absolute(v1, v2) {
                return state.relative ? v1 + v2 : v2;
            }

            this.parse = function (chunk) {

                //remove comments from chunk.
                //var lines = chunk.replace(/;.+/g, '').split('\n');
                //or not
                var lines = chunk.split('\n');

                //handle partial lines from previous chunk.
                lines[0] = previousPiece + lines[0];
                previousPiece = lines[lines.length - 1];

                //note -1 so we dont process last line in case it is a partial.
                //Todo process the last line. Probably not needed since last line is usually gcode cleanup and not extruded lines.
                for (var i = 0; i < lines.length - 1; i++) {

                    filePos+=lines[i].length+1;//+1 because of split \n. 
                    
                    //Process comments
                    //figure out line color from comments.
                    if (lines[i].indexOf(";")>-1 ) {
                        var cmdLower=lines[i].toLowerCase();
                        if (cmdLower.indexOf("inner") > -1) {
                            curColor = new THREE.Color(0x00ff00);//green
                        }
                        else if (cmdLower.indexOf("outer") > -1) {
                            curColor = new THREE.Color('red');
                        }
                        else if (cmdLower.indexOf("perimeter") > -1) {
                            curColor = new THREE.Color('red');
                        }
                        else if (cmdLower.indexOf("fill") > -1) {
                            curColor = new THREE.Color('orange');
                        }
                        else if (cmdLower.indexOf("skin") > -1) {
                            curColor = new THREE.Color('yellow');
                        }
                        else if (cmdLower.indexOf("support") > -1) {
                            curColor = new THREE.Color('skyblue');
                        }
                        else if (cmdLower.indexOf("skirt") > -1) {
                            curColor = new THREE.Color('skyblue');
                        }
                        else
                        {
                            //var curColorHex = (Math.abs(cmd.hashCode()) & 0xffffff);
                            //curColor = new THREE.Color(curColorHex);
                            //console.log(cmd + ' ' + curColorHex.toString(16))
                        }
                        //console.log(lines[i])
                    }


                    //remove comments and process command part of line.
                    var tokens = lines[i].replace(/;.+/g, '').split(' ');
                    if(tokens.length<1)
                        continue; //nothing left to process.

                    var cmd = tokens[0].toUpperCase();

                    //Arguments
                    var args = {};
                    tokens.splice(1).forEach(function (token) {
                        if (token[0] !== undefined) {
                            var key = token[0].toLowerCase();
                            var value = parseFloat(token.substring(1));
                            args[key] = value;
                        }
                    });

                    //G0/G1 - Linear Movement
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

                        //make sure extruding is updated. might not be needed.
                        //line.extruding = delta(state.e, line.e) > 0;
                        //if (line.extruding)
                        //    addSegment(state, line);//only if extruding right now.

                        //If E is defined in the args then extruding. Todo. is this right?
                        if(args.e !== undefined)
                            this.addSegment(state, line);//only if extruding right now.
                        state = line;
                    } else if (cmd === 'G2' || cmd === 'G3') {
                        //G2/G3 - Arc Movement ( G2 clock wise and G3 counter clock wise )
                        /*var arc = {
                            x: args.x !== undefined ? absolute( state.x, args.x ) : state.x,
                            y: args.y !== undefined ? absolute( state.y, args.y ) : state.y,
                            z: args.z !== undefined ? absolute( state.z, args.z ) : state.z,
                            i: args.i !== undefined ? absolute( state.i, args.i ) : state.i,
                            j: args.j !== undefined ? absolute( state.j, args.j ) : state.j,
                            k: args.k !== undefined ? absolute( state.k, args.k ) : state.k,
                            e: args.e !== undefined ? absolute( state.e, args.e ) : state.e,
                            f: args.f !== undefined ? absolute( state.f, args.f ) : state.f,
                        };*/
                        


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

        };

        //todo move to new file or remove.
        function updateDimensions(bsize) {

            if(dimensionsGroup===undefined)
            {
                dimensionsGroup = new THREE.Group();
                dimensionsGroup.name = 'dimensions';
                scene.add(dimensionsGroup);
            }

            var fontLoader = new THREE.FontLoader();
            fontLoader.load('/plugin/prettygcode/static/js/helvetiker_bold.typeface.json', function (font) {
                var xMid, text;
                var color = 0x006699;
                var matDark = new THREE.LineBasicMaterial({
                    color: color,
                    side: THREE.DoubleSide
                });
                var matLite = new THREE.MeshBasicMaterial({
                    color: color,
                    transparent: true,
                    opacity: 0.8,
                    side: THREE.DoubleSide
                });
                var center = new THREE.Vector3(0, 0, 0);
                sceneBounds.getCenter(center);
                //console.log(["center",center]);
                //clear out any old lines
                for (var i = dimensionsGroup.children.length - 1; i >= 0; i--) {
                    dimensionsGroup.remove(dimensionsGroup.children[i]);
                }
                var textHeight = 3;
                var textZ = 0.2;
                var message = bsize.x.toFixed(2) + " MM";
                var shapes = font.generateShapes(message, textHeight);
                var geometry = new THREE.ShapeBufferGeometry(shapes);
                geometry.computeBoundingBox();
                xMid = -0.5 * (geometry.boundingBox.max.x - geometry.boundingBox.min.x);
                geometry.translate(xMid, 0, 0);
                // make shape ( N.B. edge view not visible )
                text = new THREE.Mesh(geometry, matLite);
                text.position.set(center.x, sceneBounds.min.y - (textHeight * 2), textZ);
                dimensionsGroup.add(text);
                var lineMat = new THREE.LineMaterial({
                    linewidth: 6,
                    color: color
                });
                lineMat.resolution.set(gcodeWid, gcodeHei);
                var lineGeo = new THREE.LineGeometry();
                var lineVerts = [
                    sceneBounds.min.x, sceneBounds.min.y - (textHeight * 0.8), textZ,
                    sceneBounds.max.x, sceneBounds.min.y - (textHeight * 0.8), textZ,
                    sceneBounds.min.x, sceneBounds.min.y - 1, textZ,
                    sceneBounds.min.x, sceneBounds.min.y - (textHeight * 1.2), textZ,
                    sceneBounds.max.x, sceneBounds.min.y - 1, textZ,
                    sceneBounds.max.x, sceneBounds.min.y - (textHeight * 1.2), textZ,
                ];
                lineGeo.setPositions(lineVerts);
                var line = new THREE.Line2(lineGeo, lineMat);
                dimensionsGroup.add(line);
                var textHeight = 3;
                var message = bsize.y.toFixed(2) + " MM";
                var shapes = font.generateShapes(message, textHeight);
                var geometry = new THREE.ShapeBufferGeometry(shapes);
                geometry.computeBoundingBox();
                xMid = -0.5 * (geometry.boundingBox.max.x - geometry.boundingBox.min.x);
                geometry.translate(xMid, 0, 0);
                geometry.rotateZ(Math.PI / 2);
                // make shape ( N.B. edge view not visible )
                text = new THREE.Mesh(geometry, matLite);
                text.position.set(sceneBounds.max.x + (textHeight * 2), center.y, textZ);
                dimensionsGroup.add(text);
                var lineGeo = new THREE.LineGeometry();
                var lineVerts = [
                    sceneBounds.max.x + (textHeight * 0.8), sceneBounds.min.y, textZ,
                    sceneBounds.max.x + (textHeight * 0.8), sceneBounds.max.y, textZ,
                    sceneBounds.max.x + 1, sceneBounds.min.y, textZ,
                    sceneBounds.max.x + (textHeight * 1.2), sceneBounds.min.y, textZ,
                    sceneBounds.max.x + 1, sceneBounds.max.y, textZ,
                    sceneBounds.max.x + (textHeight * 1.2), sceneBounds.max.y, textZ,
                ];
                lineGeo.setPositions(lineVerts);
                var line = new THREE.Line2(lineGeo, lineMat);
                dimensionsGroup.add(line);
                var textHeight = 3;
                var message = bsize.z.toFixed(2) + " MM";
                var shapes = font.generateShapes(message, textHeight);
                var geometry = new THREE.ShapeBufferGeometry(shapes);
                geometry.computeBoundingBox();
                xMid = 0; // - 0.5 * ( geometry.boundingBox.max.x - geometry.boundingBox.min.x );
                geometry.translate(xMid, 0, 0);
                geometry.rotateX(Math.PI / 2);
                // make shape ( N.B. edge view not visible )
                text = new THREE.Mesh(geometry, matLite);
                text.position.set(sceneBounds.max.x + (textHeight * 1), sceneBounds.max.y, center.z);
                dimensionsGroup.add(text);
                var lineGeo = new THREE.LineGeometry();
                var lineVerts = [
                    sceneBounds.max.x + (textHeight * 0.8), sceneBounds.max.y + (textHeight * 0.8), 0,
                    sceneBounds.max.x + (textHeight * 0.8), sceneBounds.max.y + (textHeight * 0.8), bsize.z,
                ];
                lineGeo.setPositions(lineVerts);
                var line = new THREE.Line2(lineGeo, lineMat);
                dimensionsGroup.add(line);
            });
        }

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
            renderer = new THREE.WebGLRenderer({ canvas: document.getElementById("mycanvas"),antialias: pgSettings.antialias });
            //todo. is this right?
            renderer.setPixelRatio(window.devicePixelRatio);

            //renderer2 = new THREE.WebGLRenderer({ canvas: document.getElementById("pipcanvas") });
            //todo. is this right?
            //renderer2.setPixelRatio(window.devicePixelRatio*3.0);


            //todo allow save/pos camera at start.
            camera = new THREE.PerspectiveCamera(70, 2, 0.1, 10000);
            camera.up.set(0,0,1);
            camera.position.set(bedVolume.width, 0, 50);

            CameraControls.install({ THREE: THREE });
            clock = new THREE.Clock();

            var canvas = $("#mycanvas");
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
            
            // light = new THREE.PointLight(0xffffff);
            // light.position.set(bedVolume.width/2, bedVolume.depth/2,bedVolume.height);
            // scene.add(light);

            cameraLight = new THREE.PointLight(0xffffff);
            cameraLight.position.copy(camera.position);
            scene.add(cameraLight);

            // light = new THREE.AmbientLight( 0xffffff ); // soft white light
            // scene.add( light );

            // light = new THREE.PointLight(0xffffff);
            // light.position.copy(camera.position);
            // scene.add(light);
                       

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
                if(curPrinterState && 
                    (curPrinterState.flags.printing || curPrinterState.flags.paused) && 
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
                    //    gcodeProxy.syncGcodeObjTo(curState.layerZ,curState.lineNumber-1/*-window.fudge*/);//todo. figure out why *2 is needed.
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
                    //console.log(nv);
                    //highlightMaterial.uniforms.linewidth.value=nv*15;
                    nv=0.5;
                    highlightMaterial.uniforms.diffuse.value.r=nv;
                    highlightMaterial.uniforms.diffuse.value.g=nv;
                    highlightMaterial.uniforms.diffuse.value.b=nv;
                }


                //if(gcodeProxy)
                //    gcodeProxy.animateLayers(elapsed)



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
                    // //do real time reflections. Probably overkill. Certianly overkill.
                    // if(pgSettings.reflections && cubeCamera && nozzleModel)
                    // {
                    //     cubeCamera.position.copy( nozzleModel.position );
                    //     cubeCamera.position.z=cubeCamera.position.z+10;
                    //     nozzleModel.visible=false;
                    //     cubeCamera.update( renderer, scene );
                    //     nozzleModel.visible=true;
                    // }

                    renderer.render(scene, camera);
                }else{
                    //console.log("idle");
                }

                //renderer2.render(scene, camera);
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
                
            console.log([existingPlane,existingGrid]);
            
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
    }

    OCTOPRINT_VIEWMODELS.push({
        construct: PrettyGCodeViewModel,
        dependencies: ["settingsViewModel","loginStateViewModel", "printerProfilesViewModel"],
        elements: ["#tab_plugin_prettygcode"]
    });


});


