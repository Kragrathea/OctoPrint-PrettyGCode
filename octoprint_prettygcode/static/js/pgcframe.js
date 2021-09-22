$(function () {

    console.log("Create pcgframe View Model");
    function PrettyGCodeFrameViewModel(parameters) {
        var self = this;
        self.printerProfiles = parameters[2];
        self.controlViewModel = parameters[3];


        //check url for fullscreen mode
        let searchParams = new URLSearchParams(window.location.search)
        if(searchParams.has('fullscreen'))
            $(".page-container").addClass("pgfullscreen");

        //setup window toggle buttons
        $(".fstoggle").on("click", function () {
            $(".page-container").toggleClass("pgfullscreen");
        });

        $(".pgsettingstoggle").hide();
        $(".pgdashtoggle").hide();
        $(".pgcameratoggle").hide();

        $("#state_wrapper").addClass("pghidden");
        $(".pgstatetoggle").on("click", function () {
            //pgSettings.showState=!pgSettings.showState;
            if ($("#state_wrapper").hasClass("pghidden")) {
                $("#state_wrapper").removeClass("pghidden");
            }
            else {
                $("#state_wrapper").addClass("pghidden");
            }
        });
        $("#files_wrapper").addClass("pghidden");
        $(".pgfilestoggle").on("click", function () {
            //pgSettings.showFiles=!pgSettings.showFiles;
            if ($("#files_wrapper").hasClass("pghidden")) {
                $("#files_wrapper").removeClass("pghidden");
            }
            else {
                $("#files_wrapper").addClass("pghidden");
            }
        });        
        
        //Parse terminal data for file and pos updates.
        var curJobName="";
        var durJobDate=0;//use date of file to check for update. 
        function updateJob(job){
            
            if (durJobDate != job.file.date) {
                curJobName = job.file.path;
                durJobDate = job.file.date;
                // if(viewInitialized && gcodeProxy)
                //     {
                //         gcodeProxy.loadGcode('/downloads/files/local/' + curJobName);
                //         printHeadSim=new PrintHeadSimulator();

                //         //terminalGcodeProxy = new GCodeParser();
                //         //terminalGcodeProxy;//used to display gcode actualy sent to printer.
                //     }
            }

        }
        self.fromHistoryData = function(data) {
            if(!viewInitialized)
                return;

            updateJob(data.job);
        };

        var curPrinterState=null;
        var curPrintFilePos=0;
        self.fromCurrentData= function (data) {
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

        var bedVolume = undefined;
        var viewInitialized = false;
        self.onTabChange = function (current, previous) {

            if (current == "#tab_plugin_prettygcode") {
                if (!viewInitialized) {
                    viewInitialized = true;

                    $("#pgciframe").attr("src","/plugin/prettygcode/static/pgcode/pgcode.html?embedded=1&server="+document.location.origin)
                    //+"&apiKey=")

                    // //Watch for bed volume changes
                    // self.printerProfiles.currentProfileData.subscribe(
                    //     function(){
                    //     });

            } else if (previous == "#tab_plugin_prettygcode") {
                //todo. disable animation 
                
                //Disable camera when tab isnt visible.
                //$(".gwin #pg_webcam_image").attr("src", "")
                //self.controlViewModel._disableWebcam();
            }
            self.controlViewModel._enableWebcam();
        };


    }}

    let searchParams = new URLSearchParams(window.location.search)
    if(!searchParams.has('oldpgc'))
        OCTOPRINT_VIEWMODELS.push({
            construct: PrettyGCodeFrameViewModel,
            dependencies: ["settingsViewModel","loginStateViewModel", "printerProfilesViewModel","controlViewModel"],
            elements: ["#tab_plugin_prettygcode"]
        });


});


