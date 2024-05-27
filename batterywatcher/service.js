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
const path = require("path");



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

async function batteryCheck(){
    let vehicles = config.monitoringDevices;
    let vehicleConfig = null;
    let id = null;

    for (let i = 0; i < vehicles.length; i++) {
        id = vehicles[i].key;
        vehicleConfig = getDeviceConfigByKey(id);

        let line = await readLastLines.read(`${config.pluginUploadPath}/${id}.csv`, 1);
        let row = line.split(",");
        row[0] = new Date(parseInt(row[0])).toLocaleString();
        row[1] = parseFloat(row[1]);

        try {
            if (vehicleConfig.alarm_threshhold > row[1]){
                process.send({adminMsg: `${vehicleConfig.vehicleName} Batteriestand niedrig: ${row[1]} Volt`});
            }else if(Date.now() - new Date(row[0]) > vehicleConfig.maxNoReplyTime * 3600000){ // hours to milliseconds
                process.send({adminMsg: `${vehicleConfig.vehicleName} Batteriemesser hat sich seit ${vehicleConfig.maxNoReplyTime} Stunden nicht mehr am Server gemeldet.`});
            }
        } catch (error) {
            LogAtMain(`Error checking battery voltage file: ${vehicleConfig.vehicleName}: ${error}`);
            process.send({adminMsg: `Fehler beim auslesen der ${vehicleConfig.vehicleName} Spannungshistorie: ${error}`});
        }
    }
}

// Api

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '/views'));

app.get('/batterywatcher/dashboard',async (request, response) => {
    LogAtMain(`Voltage Dashboard requested via http`);
    let vehicleData = [];

    for (let i = 0; i < config.monitoringDevices.length; i++) {
        let filename = config.monitoringDevices[i].key;
        let vehicleConfig = "";
        try {
            vehicleConfig = JSON.parse(config.monitoringDevices[i].value)
        } catch (error) {
            LogAtMain(`Error loading Dashboard: ${error}`);
        }
        vehicleConfig = vehicleConfig;
        let data = {
            name: vehicleConfig.vehicleName,
            capacity: 0,
            timestamps: [],
            voltages: []
        };
        let lines = await readLastLines.read(`${config.pluginUploadPath}/${filename}.csv`, 50);
        let splitLines = String(lines).split("\n");
        splitLines.pop(); 
        let row = null;
        splitLines.forEach(line => {
            row = line.split(",");
            data.timestamps.push(new Date(parseInt(row[0])).toLocaleDateString().slice(0,4) + " " + new Date(parseInt(row[0])).toLocaleTimeString().slice(0,5));
            data.voltages.push(parseFloat(row[1]));
        });
        let last_voltage = parseFloat(row[1]);
        if     (last_voltage >= 12.9) {data.capacity =  "100%"; }
        else if(last_voltage >= 12.8) {data.capacity =  "90%"; }
        else if(last_voltage >= 12.6) {data.capacity =  "80%"; }
        else if(last_voltage >= 12.5) {data.capacity =  "70%"; }
        else if(last_voltage >= 12.4) {data.capacity =  "60%"; }
        else if(last_voltage >= 12.25){data.capacity =  "50% (Aufladen empfohlen)"; }
        else if(last_voltage >= 12.1) {data.capacity =  "40% (Aufladen empfohlen)"; }
        else if(last_voltage >= 11.9) {data.capacity =  "30% (Aufladen dringend empfohlen)"; }
        else if(last_voltage >= 11.8) {data.capacity =  "20% (Aufladen dringend empfohlen)"; }
        else if(last_voltage >= 11.5) {data.capacity =  "0-10%% (Aufladen dringend empfohlen)"; }
        else {data.capacity =  " <0% Tiefentladen!!!"; }

        vehicleData.push(data);
    }

    console.log(vehicleData)

    response.render('dashboard', {
        subject: 'Batterymonitor Dashboard',
        vehicles: vehicleData
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
        res.status(200).send({ "last_voltages": voltages.reverse()});
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

