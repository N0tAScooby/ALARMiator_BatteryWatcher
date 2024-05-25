/**
 *  BatteryWatcher Service
 * 
 *  description:    This class is called in a separate node process 
 *                  in Plugin "Battery Watcher". This service serves a rudimentary api to
 *                  enable esp2866 battery monitoring.
 * 
 * 
 *  author:         Darren Fürst
 *  version:        1.0.0 
 * 
 */
var app = require('express')();
const { stringify } = require("csv-stringify");
const { parse } = require("csv-parse");
const fs = require("fs");
const compareVersions = require('compare-versions');
var bodyParser = require('body-parser');
const readLastLines = require('read-last-lines');




var config = null;

var jsonParser = bodyParser.json()
var urlencodedParser = bodyParser.urlencoded({ extended: false })


/**
 * Log Function for inter process communication
 */
function LogAtMain(msg) {
    process.send({logmessage : msg });
}

/**
 * 
 * Wire messages coming from Plugin base.js
 * 
 */
process.on('message', (msg) => {
    if (typeof msg.config != 'undefined') {
        config = msg.config;
        serviceState = 1;
        LogAtMain('Loaded service configuration');
    }
    if (typeof msg.battery_check != 'undefined') {
        if (msg.battery_check === 1) {
            batteryCheck();
        }
    }
    if (typeof msg.quit != 'undefined') {
        LogAtMain('Shut down Battery-Watcher service');
        process.exit();
    }
    if (typeof msg.start != 'undefined') {
        if (msg.start === 1) {
            if (serviceState === 1) {
                LogAtMain('Starting Battery-Watcher Service');
                serviceState = 2;
                app.listen(config.port, () => {
                    LogAtMain(`BatteryWatcher HTTP-Server is running on port: ${config.port}`);
                });
            } else {
                LogAtMain('Service not in configured and stopped state. Not starting service');
            }
        }
    }
});

function getDeviceConfigByKey(key){
    let devices = config.monitoringDevices;
    let values = "";
    devices.forEach(device => {
        if (device.key == key){
            try {
                values = JSON.parse(device.value);
            } catch (error) {
                LogAtMain(`Unable to parse config value for device with key ${key}`);
            }
        }
    });

    if (values == {}){
        LogAtMain(`Device with key: ${key} could not be found. Is it configured in the plugin settings?`);
    }
    return values;
}

function batteryCheck(){
    let vehicles = config.monitoringDevices;
    let vehicleConfig = null;
    let last_row = null;

    vehicles.forEach(vehicle => {
        id = vehicle.key
        vehicleConfig = getDeviceConfigByKey(id);

        fs.createReadStream(`${config.pluginUploadPath}/${id}.csv`)
        .pipe(parse({ delimiter: ","}))
        .on("data", function (row) {
            last_row = row;
        })
        .on("end", function () {
            // check if voltage is too low and if timestamp is out of range
            try {
                if (vehicleConfig.alarm_threshhold > parseFloat(last_row[1])){
                    process.send({adminMsg: `${vehicleConfig.vehicleName} Batteriestand niedrig: ${parseFloat(last_row[1])} Volt`});
                }else if(Date.now() - new Date(parseInt(last_row[0])) > vehicleConfig.maxNoReplyTime * 3600000){ // hours to milliseconds
                    process.send({adminMsg: `${vehicleConfig.vehicleName} Batteriemesser hat sich seit ${vehicleConfig.maxNoReplyTime} Stunden nicht mehr am Server gemeldet.`});
                }
            } catch (error) {
                LogAtMain(`Error checking battery voltage file: ${vehicleConfig.vehicleName}: ${error}`);
                process.send({adminMsg: `Fehler beim auslesen der ${vehicleConfig.vehicleName} Spannungshistorie: ${error}`});
            }
            
        })
        .on("error", function (error) {
            LogAtMain(`Error checking battery voltage for ${vehicleConfig.vehicleName}: ${error}`);
        });
    });

}

// Api

app.set('view engine', 'ejs');

app.get('/index', (request, response) => {
    
    for (let i = 0; i < config.monitoringDevices; i++) {
        let filename = config.monitoringDevices[i].key;

    }



    response.render('dashboard', {
      subject: 'Batterymonitor Dashboard',
     vehicles: []
    });
  });

app.get('/batterywatcher/config/:id/:softwareVersion', (req, res) => {

    vehicleConfig = getDeviceConfigByKey(req.params.id);
    if (vehicleConfig == ""){
        res.sendStatus(400);
        return;
    }
    LogAtMain(`${vehicleConfig.vehicleName}: is running softwareVersion: ${req.params.softwareVersion}`);
    vehicleConfig.updateNeeded = compareVersions.compare(config.currentSoftwareVersion, req.params.softwareVersion, ">"); 
    if(vehicleConfig.updateNeeded){
        process.send({adminMsg: `${vehicleConfig.vehicleName} hat alte Firmware. Schicke Updatebefehl an Batteriewächter.`});
    }
    res.status(200);
    res.send(vehicleConfig);
})

app.get('/batterywatcher/status/:id/:rowsAmount', (req, res) => {
    vehicleConfig = getDeviceConfigByKey(req.params.id);
    if (vehicleConfig == ""){
        res.sendStatus(400);
        return;
    }
    let voltages = []

    readLastLines.read(`${config.pluginUploadPath}/${req.params.id}.csv`, req.params.rowsAmount)
    .then((lines) => {
        let splitLines = String(lines).split("\n");
        splitLines.pop();
        splitLines.forEach(line => {
            let row = line.split(",");
            row[0] = new Date(parseInt(row[0])).toLocaleString();
            voltages.push(row);
        });
        LogAtMain(`${vehicleConfig.vehicleName}: voltage history requested via http`);
        res.status(200).send({ "last_voltages": voltages });
        return;
    });
})

app.get('/batterywatcher/update/:id/firmware.bin', (req, res) => {
    vehicleConfig = getDeviceConfigByKey(req.params.id);
    if (vehicleConfig == ""){
        res.sendStatus(400);
        return;
    }
    
    LogAtMain(`${vehicleConfig.vehicleName}: Firmware requested`);
    
    res.sendFile(`${config.pluginUploadPath}/firmware.bin`, (err) => {
        if(err){
            res.sendStatus(500);
            process.send({adminMsg: `${vehicleConfig.vehicleName} Fehler beim Firmware upload: ${err}`});
            return
        }else{
            process.send({adminMsg: `${vehicleConfig.vehicleName} hat neues Firmware Update heruntergeladen`});
        }
    });
});


app.post("/batterywatcher/:id", jsonParser, (req, res) => {
    vehicleConfig = getDeviceConfigByKey(req.params.id);

    if (vehicleConfig == ""){
        res.sendStatus(400);
        return;
    }
    const writableStream = fs.createWriteStream(`${config.pluginUploadPath}/${req.params.id}.csv`, { flags: 'a' });
    const stringifier = stringify({ header: false, columns: config.csvColumns });
    try {
        stringifier.write([Date.now(), req.body.voltage]);
        stringifier.pipe(writableStream);
    } catch (error) {
        res.sendStatus(500);
        return;
    }   
    LogAtMain(`${vehicleConfig.vehicleName} new voltage (${req.body.voltage}V) added to database`);
    res.sendStatus(200);
})

