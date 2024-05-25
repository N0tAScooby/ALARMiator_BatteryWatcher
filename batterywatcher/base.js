const PluginBaseTemplate = require('./../../templates/pluginBaseTemplate');
const manifest = require('./manifest.json');
const fs = require("fs");


class BatteryWatcher extends PluginBaseTemplate {
    constructor() {
        super(manifest, __dirname);
        this.cronjobName = "BatteryWatcher";
        this.csvColumns = [
            "timestamp",
            "voltage"
        ]

        // times to send alarm
        this.earliestTime = 9;
        this.latestTime = 20;
    }

    // @Overwrite
    initializePlugin(callback) {
        let configArray = this.getConfigValue('batteryWatcherConfig');

        if (configArray != null) {
            try {
                configArray = JSON.parse(configArray);
            }
            catch (error) {
                global.plgManager.logger.info("Error parsing config", {label: this.logIdentifier})
                callback(false);
            }
        }
            this.config = {
                monitoringDevices: configArray,
                currentSoftwareVersion: this.getConfigValue('currentSoftwareVersion'),
                monitoringScript: this.getConfigValue('monitoringScript'),
                pluginUploadPath: this.getPluginUploadsPath(),
                csvColumns: this.csvColumns,
                port: this.getConfigValue('port')
            }
            callback(true);
    }

    // @Overwrite
    registerCronjobs(){
        global.plgManager.logger.info(`Registering Batterymonitor check as Cronjob`, {label: this.logIdentifier});   

        for (let time = this.earliestTime; time <= this.latestTime; time++) {
            let schedule = "0 ?1 * * *";
            schedule = schedule.replace("?1", time);
            this.addCronjob(this.cronjobName + time, "check_batteries" + time, schedule, "check_batteries" + time, "", () =>{
                this.subProcess.send({ battery_check: 1 });
            });
        }

        // remove
        this.subProcess.send({battery_check: 1});

    }

      /**
     * Wires messages from service to event model of plugin
     * All Messages in service need to be wired here to be recognised in plugin
     */
      wireServiceCommunication() {
        this.subProcess.on('message', function (msg) {
            var payload = msg;
            
            if (payload.logmessage !== undefined) {
                global.plgManager.logger.info(`${decodeURIComponent(payload.logmessage)}`, {label: this.logIdentifier});
            } else if(payload.adminMsg !== undefined){
                global.plgManager.logger.info(`Sending Admin messages`, {label: this.logIdentifier});
                global.plgManager.event_new_admin_notification(`${payload.adminMsg}`);
            } else {
                global.plgManager.logger.info('UNSOLICITED MESSAGE: ' + JSON.stringify(msg), {label: this.logIdentifier});
            }
        }.bind(this));
    }

    /**
     * Runs after initializePlugin has been called and enables hooking into the startup directly after the initiation
     * This may be necessary since the initiation process is asynchronous
     */
    afterInit(){
        this.registerCronjobs();
        this.createVehicleStorageFiles();
    }

    /**
     * Creates the storage file if it doesnt exist yet
     */
    createVehicleStorageFiles(){
        this.config.monitoringDevices.forEach(vehicle => {
            fs.writeFile(`${this.config.pluginUploadPath}/${vehicle.key}.csv`, "", { flag: 'wx' }, (err) => {
                if (err) {
                    if (err.code === 'EEXIST') {
                        global.plgManager.logger.info(`Folder for vehicle ${vehicle.key} already exists`, {label: this.logIdentifier});
                      }else{
                          global.plgManager.logger.info(`Error creating folder: ${err}`, {label: this.logIdentifier});
                          global.plgManager.event_new_admin_notification(`Fehler beim erstellen des Files für Batteriemonitor ${vehicle.key}: ${err}`);
                      }
                }else{
                    global.plgManager.logger.info(`Created folder for device: ${vehicle.key}`, {label: this.logIdentifier});
                    global.plgManager.event_new_admin_notification(`Neuer Batteriemonitor mit ID ${vehicle.key} erfolgreich angelegt.`);
                }
            });
        });
    }

}
module.exports = BatteryWatcher;