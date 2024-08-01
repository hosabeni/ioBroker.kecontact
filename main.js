'use strict';

/*
 * Created with @iobroker/create-adapter v1.33.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require('@iobroker/adapter-core');

// Load your modules here, e.g.:
const dgram = require('dgram');
const request = require('request');

/**
 * The adapter instance
 * @type {ioBroker.Adapter}
 */
let adapter;

const DEFAULT_UDP_PORT = 7090;
const BROADCAST_UDP_PORT = 7092;

let txSocket;
let rxSocketReports = null;
let rxSocketBroadcast = null;
let sendDelayTimer = null;
const states = {};          // contains all actual state values
const stateChangeListeners = {};
const currentStateValues = {}; // contains all actual state values
const sendQueue = [];
const MODEL_P20 = 1;        // product ID is like KC-P20-ES240030-000-ST
const MODEL_P30 = 2;
const MODEL_BMW = 3;        // product ID is like BMW-10-EC2405B2-E1R
const TYPE_A_SERIES = 1;
const TYPE_B_SERIES = 2;
const TYPE_C_SERIES = 3;     // product ID for P30 is like KC-P30-EC240422-E00
const TYPE_E_SERIES = 4;     // product ID for P30 is like KC-P30-EC240422-E00
const TYPE_X_SERIES = 5;
const TYPE_D_EDITION = 6;    // product id (only P30) is KC-P30-EC220112-000-DE, there's no other


//var ioBroker_Settings
let ioBrokerLanguage      = 'en';
const chargeTextAutomatic = {'en': 'PV automatic active', 'de': 'PV-optimierte Ladung'};
const chargeTextMax       = {'en': 'max. charging power', 'de': 'volle Ladeleistung'};

let wallboxWarningSent   = false;  // Warning for inacurate regulation with Deutshcland Edition
let wallboxUnknownSent   = false;  // Warning wallbox not recognized
let isPassive            = true;   // no automatic power regulation?
let lastDeviceData       = null;   // time of last check for device information
const intervalDeviceDataUpdate = 24 * 60 * 60 * 1000;  // check device data (e.g. firmware) every 24 hours => 'report 1'
let intervalPassiveUpdate = 10 * 60 * 1000;  // check charging information every 10 minutes
let timerDataUpdate      = null;   // interval object for calculating timer
const intervalActiceUpdate = 15 * 1000;  // check current power (and calculate PV-automatics/power limitation every 15 seconds (report 2+3))
let lastCalculating      = null;   // time of last check for charging information
const intervalCalculating = 25 * 1000;  // calculate charging poser every 25(-30) seconds
let chargingToBeStarted = false;   // tried to start charging session last time?
let loadChargingSessions = false;
let photovoltaicsActive  = false;  // is photovoltaics automatic active?
let useX1switchForAutomatic = true;
let maxPowerActive       = false;  // is limiter für maximum power active?
let wallboxIncluded      = true;   // amperage of wallbox include in energy meters 1, 2 or 3?
let amperageDelta        = 500;    // default for step of amperage
let underusage           = 0;      // maximum regard use to reach minimal charge power for vehicle
const minAmperageDefault = 6000;   // default minimum amperage to start charging session
let minAmperage          = 5000;   // minimum amperage to start charging session
let minChargeSeconds     = 0;      // minimum of charge time even when surplus is not sufficient
let minRegardSeconds     = 0;      // maximum time to accept regard when charging
let min1p3pSwSec         = 0;      // minimum time betwenn phase switching
let isMaxPowerCalculation = false; // switch to show if max power calculation is active
let valueFor1p3pOff      = null;   // value that will be assigned to 1p/3p state when vehicle is unplugged (unpower switch)
let valueFor1pCharging   = null;   // value that will be assigned to 1p/3p state to switch to 1 phase charging
let valueFor3pCharging   = null;   // value that will be assigned to 1p/3p state to switch to 3 phase charging
let stateFor1p3pCharging = null;   // state for switching installation contactor
let stateFor1p3pAck      = false;  // Is state acknowledged?
let stepFor1p3pSwitching = 0;      // 0 = nothing to switch, 1 = stop charging, 2 = switch phases, 3 = acknowledge switching, -1 = temporarily disabled
let retries1p3pSwitching = 0;
let valueFor1p3pSwitching = null;  // value for switch
let batteryStrategy      = 0;      // default = don't care for a battery storage
let startWithState5Attempted = false; // switch, whether a start command was tried once even with state of 5
const voltage            = 230;    // calculate with european standard voltage of 230V
const firmwareUrl        = 'https://www.keba.com/en/emobility/service-support/downloads/downloads';
const regexP30cSeries    = /<h3 .*class="headline *tw-h3 ">(?:(?:\s|\n|\r)*?)Updates KeContact P30 a-\/b-\/c-\/e-series((?:.|\n|\r)*?)<h3/gi;
//const regexP30xSeries    = /<h3 .*class="headline *tw-h3 ">(?:(?:\s|\n|\r)*?)Updates KeContact P30 x-series((?:.|\n|\r)*?)<h3/gi;
const regexFirmware      = /<div class="mt-3">Firmware Update\s+((?:.)*?)<\/div>/gi;
const regexCurrFirmware  = /P30 v\s+((?:.)*?)\s+\(/gi;

const stateWallboxEnabled      = 'enableUser';                  /*Enable User*/
const stateWallboxCurrent      = 'currentUser';                 /*Current User*/
const stateWallboxMaxCurrent   = 'currentHardware';             /*Maximum Current Hardware*/
const stateWallboxPhase1       = 'i1';                          /*Current 1*/
const stateWallboxPhase2       = 'i2';                          /*Current 2*/
const stateWallboxPhase3       = 'i3';                          /*Current 3*/
const stateWallboxPlug         = 'plug';                        /*Plug status */
const stateWallboxState        = 'state';                       /*State of charging session */
const stateWallboxPower        = 'p';                           /*Power*/
const stateWallboxChargeAmount = 'ePres';                       /*ePres - amount of charged energy in Wh */
const stateWallboxDisplay      = 'display';
const stateWallboxOutput       = 'output';
const stateSetEnergy           = 'setenergy';
const stateReport              = 'report';
const stateStart               = 'start';
const stateStop                = 'stop';
const stateSetDateTime         = 'setdatetime';
const stateUnlock              = 'unlock';
const stateProduct             = 'product';
const stateX1input             = 'input';
const stateFirmware            = 'firmware';                    /*current running version of firmware*/
const stateFirmwareAvailable   = 'statistics.availableFirmware';/*current version of firmware available at keba.com*/
const stateSurplus             = 'statistics.surplus';          /*current surplus for PV automatics*/
const stateMaxPower            = 'statistics.maxPower';         /*maximum power for wallbox*/
const stateChargingPhases      = 'statistics.chargingPhases';   /*number of phases with which vehicle is currently charging*/
const statePlugTimestamp       = 'statistics.plugTimestamp';    /*Timestamp when vehicled was plugged to wallbox*/
const stateChargeTimestamp     = 'statistics.chargeTimestamp';  /*Timestamp when charging (re)started */
const stateRegardTimestamp     = 'statistics.regardTimestamp';  /*Timestamp when charging session was continued with regard */
const state1p3pSwTimestamp     = 'statistics.1p3pSwTimestamp';  /*Timestamp when 1p3pSw was changed */
const stateSessionId           = 'statistics.sessionId';        /*id of current charging session */
const stateRfidTag             = 'statistics.rfid_tag';         /*rfid tag of current charging session */
const stateRfidClass           = 'statistics.rfid_class';       /*rfid class of current charging session */
const stateWallboxDisabled     = 'automatic.pauseWallbox';      /*switch to generally disable charging of wallbox, e.g. because of night storage heater */
const statePvAutomatic         = 'automatic.photovoltaics';     /*switch to charge vehicle in regard to surplus of photovoltaics (false= charge with max available power) */
const stateAddPower            = 'automatic.addPower';          /*additional regard to run charging session*/
const stateLimitCurrent        = 'automatic.limitCurrent';      /*maximum amperage for charging*/
const stateManualPhases        = 'automatic.calcPhases';        /*count of phases to calculate with for KeContact Deutschland-Edition*/
const stateBatteryStrategy     = 'automatic.batteryStorageStrategy'; /*strategy to use for battery storage dynamically*/
const stateMinimumSoCOfBatteryStorage = 'automatic.batterySoCForCharging'; /*SoC above which battery storage may be used for charging vehicle*/
const stateLastChargeStart     = 'statistics.lastChargeStart';  /*Timestamp when *last* charging session was started*/
const stateLastChargeFinish    = 'statistics.lastChargeFinish'; /*Timestamp when *last* charging session was finished*/
const stateLastChargeAmount    = 'statistics.lastChargeAmount'; /*Energy charging in *last* session in kWh*/
const stateMsgFromOtherwallbox = 'internal.message';            /*Message passed on from other instance*/
const stateX2Source            = 'x2phaseSource';               /*X2 switch source */
const stateX2Switch            = 'x2phaseSwitch';               /*X2 switch */

/**
 * Starts the adapter instance
 * @param {Partial<utils.AdapterOptions>} [options]
 */
function startAdapter(options) {
    // Create the adapter and define its methods
    return adapter = utils.adapter(Object.assign({}, options, {
        name: 'kecontact',

        // The ready callback is called when databases are connected and adapter received configuration.
        // start here!
        ready: onAdapterReady, // Main method defined below for readability

        // is called when adapter shuts down - callback has to be called under any circumstances!
        unload: onAdapterUnload,

        // If you need to react to object changes, uncomment the following method.
        // You also need to subscribe to the objects with `adapter.subscribeObjects`, similar to `adapter.subscribeStates`.
        // objectChange: (id, obj) => {
        //     if (obj) {
        //         // The object was changed
        //         adapter.log.info(`object ${id} changed: ${JSON.stringify(obj)}`);
        //     } else {
        //         // The object was deleted
        //         adapter.log.info(`object ${id} deleted`);
        //     }
        // },

        // is called if a subscribed state changes
        stateChange: onAdapterStateChange,

        // If you need to accept messages in your adapter, uncomment the following block.
        // /**
        //  * Some message was sent to this instance over message box. Used by email, pushover, text2speech, ...
        //  * Using this method requires 'common.messagebox' property to be set to true in io-package.json
        //  */
        // message: (obj) => {
        //     if (typeof obj === 'object' && obj.message) {
        //         if (obj.command === 'send') {
        //             // e.g. send email or pushover or whatever
        //             adapter.log.info('send command');

        //             // Send response in callback if required
        //             if (obj.callback) adapter.sendTo(obj.from, obj.command, 'Message received', obj.callback);
        //         }
        //     }
        // },
    }));
}

/**
 * Function is called after the startup of the Adapter if its ready. It's the first function which is called.
 */
function onAdapterReady() {
    if (! checkConfig()) {
        adapter.log.error('start of adapter not possible due to config errors');
        return;
    }
    if (loadChargingSessions) {
        //History Datenpunkte anlegen
        createHistory();
    }
    main();
}

/**
 * Function is called if the adapter is unloaded.
 */
function onAdapterUnload(callback) {
    try {
        if (sendDelayTimer) {
            clearInterval(sendDelayTimer);
        }

        disableChargingTimer();

        if (txSocket) {
            txSocket.close();
        }

        if (rxSocketReports) {
            if (rxSocketBroadcast.active)
                rxSocketReports.close();
        }

        if (rxSocketBroadcast) {
            if (rxSocketBroadcast.active)
                rxSocketBroadcast.close();
        }

        if (isForeignStateSpecified(adapter.config.stateRegard))
            adapter.unsubscribeForeignStates(adapter.config.stateRegard);
        if (isForeignStateSpecified(adapter.config.stateSurplus))
            adapter.unsubscribeForeignStates(adapter.config.stateSurplus);
        if (isForeignStateSpecified(adapter.config.stateBatteryCharging))
            adapter.unsubscribeForeignStates(adapter.config.stateBatteryCharging);
        if (isForeignStateSpecified(adapter.config.stateBatteryDischarging))
            adapter.unsubscribeForeignStates(adapter.config.stateBatteryDischarging);
        if (isForeignStateSpecified(adapter.config.stateBatterySoC))
            adapter.unsubscribeForeignStates(adapter.config.stateBatterySoC);
        if (isForeignStateSpecified(adapter.config.stateEnergyMeter1))
            adapter.unsubscribeForeignStates(adapter.config.stateEnergyMeter1);
        if (isForeignStateSpecified(adapter.config.stateEnergyMeter2))
            adapter.unsubscribeForeignStates(adapter.config.stateEnergyMeter2);
        if (isForeignStateSpecified(adapter.config.stateEnergyMeter3))
            adapter.unsubscribeForeignStates(adapter.config.stateEnergyMeter3);

    } catch (e) {
        if (adapter.log)   // got an exception 'TypeError: Cannot read property 'warn' of undefined'
            adapter.log.warn('Error while closing: ' + e);
    }

    callback();
}
/**
 * Function is called if a subscribed state changes
 * @param {string} id is the id of the state which changed
 * @param state is the new value of the state which is changed
 */
function onAdapterStateChange (id, state) {
    // Warning: state can be null if it was deleted!
    if (!id || !state) {
        return;
    }
    //adapter.log.silly('stateChange ' + id + ' ' + JSON.stringify(state));
    // save state changes of foreign adapters - this is done even if value has not changed but acknowledged

    const oldValue = getStateInternal(id);
    let newValue = state.val;
    setStateInternal(id, newValue);

    // if vehicle is (un)plugged check if schedule has to be disabled/enabled
    if (id == adapter.namespace + '.' + stateWallboxPlug) {
        const wasVehiclePlugged   = isVehiclePlugged(oldValue);
        const isNowVehiclePlugged = isVehiclePlugged(newValue);
        if (isNowVehiclePlugged && ! wasVehiclePlugged) {
            adapter.log.info('vehicle plugged to wallbox');
            if (stepFor1p3pSwitching < 0) {
                reset1p3pSwitching();
            }
            if (! isPvAutomaticsActive()) {
                set1p3pSwitching(valueFor3pCharging);
            }
            initChargingSession();
            forceUpdateOfCalculation();
        } else if (! isNowVehiclePlugged && wasVehiclePlugged) {
            adapter.log.info('vehicle unplugged from wallbox');
            finishChargingSession();
            set1p3pSwitching(valueFor1p3pOff);
            if (stepFor1p3pSwitching < 0) {
                reset1p3pSwitching();
            }
        }
    }

    // if the Wallbox have been disabled or enabled.
    if (id == adapter.namespace + '.' + stateWallboxDisabled) {
        if (oldValue != newValue) {
            adapter.log.info('change pause status of wallbox from ' + oldValue + ' to ' + newValue);
            newValue = getBoolean(newValue);
            forceUpdateOfCalculation();
        }
    }

    // if PV Automatic has been disable or enabled.
    if (id == adapter.namespace + '.' + statePvAutomatic) {
        if (oldValue != newValue) {
            adapter.log.info('change of photovoltaics automatic from ' + oldValue + ' to ' + newValue);
            newValue = getBoolean(newValue);
            displayChargeMode();
            forceUpdateOfCalculation();
        }
    }

    // if the state of the X1 Input has chaned.
    if (id == adapter.namespace + '.' + stateX1input) {
        if (useX1switchForAutomatic) {
            if (oldValue != newValue) {
                adapter.log.info('change of photovoltaics automatic via X1 from ' + oldValue + ' to ' + newValue);
                displayChargeMode();
                forceUpdateOfCalculation();
            }
        }
    }

    // if the value for AddPower  was changes.
    if (id == adapter.namespace + '.' + stateAddPower) {
        if (oldValue != newValue)
            adapter.log.info('change additional power from regard from ' + oldValue + ' to ' + newValue);
    }

    if (id == adapter.namespace + '.' + stateFirmware) {
        checkFirmware();
    }

    if (id == stateFor1p3pCharging) {
        stateFor1p3pAck = state.ack;
    }

    if (state.ack) {
        return;
    }
    if (! id.startsWith(adapter.namespace)) {
        // do not care for foreign states
        return;
    }

    if (!Object.prototype.hasOwnProperty.call(stateChangeListeners, id)) {
        adapter.log.error('Unsupported state change: ' + id);
        return;
    }

    stateChangeListeners[id](oldValue, newValue);
    setStateAck(id, newValue);
}


/**
 * Function is called at the end of the function onAdapterReady
 * It shows the full configuration of the adapter on the config window at start and created the upd socket.
 */
async function main() {

    // Reset the connection indicator during startup
    await adapter.setStateAsync('info.connection', false, true);

    // The adapters config (in the instance object everything under the attribute 'native') is accessible via
    // adapter.config:
    adapter.log.info('config host: ' + adapter.config.host);
    adapter.log.info('config passiveMode: ' + adapter.config.passiveMode);
    adapter.log.info('config pollInterval: ' + adapter.config.pollInterval);
    adapter.log.info('config loadChargingSessions: ' + adapter.config.loadChargingSessions);
    adapter.log.info('config useX1forAutomatic: ' + adapter.config.useX1forAutomatic);
    adapter.log.info('config stateRegard: ' + adapter.config.stateRegard);
    adapter.log.info('config stateSurplus: ' + adapter.config.stateSurplus);
    adapter.log.info('config stateBatteryCharging: ' + adapter.config.stateBatteryCharging);
    adapter.log.info('config stateBatteryDischarging: ' + adapter.config.stateBatteryDischarging);
    adapter.log.info('config stateBatterySoC: ' + adapter.config.stateBatterySoC);
    adapter.log.info('config batteryPower: ' + adapter.config.batteryPower);
    adapter.log.info('config batteryMinSoC: ' + adapter.config.batteryMinSoC);
    adapter.log.info('config batteryStorageStrategy: ' + adapter.config.batteryStorageStrategy);
    adapter.log.info('config statesIncludeWallbox: ' + adapter.config.statesIncludeWallbox);
    adapter.log.info('config.state1p3pSwitch: ' + adapter.config.state1p3pSwitch);
    adapter.log.info('config.1p3pViax2: ' + adapter.config['1p3pViaX2']);
    adapter.log.info('config.1p3pSwitchIsNO: ' + adapter.config['1p3pSwitchIsNO'] +
        ', 1p = ' + valueFor1pCharging + ', 3p = ' + valueFor3pCharging + ', off = ' + valueFor1p3pOff);
    adapter.log.info('config minAmperage: ' + adapter.config.minAmperage);
    adapter.log.info('config addPower: ' + adapter.config.addPower);
    adapter.log.info('config delta: ' + adapter.config.delta);
    adapter.log.info('config underusage: ' + adapter.config.underusage);
    adapter.log.info('config minTime: ' + adapter.config.minTime);
    adapter.log.info('config regardTime: ' + adapter.config.regardTime);
    adapter.log.info('config maxPower: ' + adapter.config.maxPower);
    adapter.log.info('config stateEnergyMeter1: ' + adapter.config.stateEnergyMeter1);
    adapter.log.info('config stateEnergyMeter2: ' + adapter.config.stateEnergyMeter2);
    adapter.log.info('config stateEnergyMeter3: ' + adapter.config.stateEnergyMeter3);
    adapter.log.info('config wallboxNotIncluded: ' + adapter.config.wallboxNotIncluded);

    /*
        For every state in the system there has to be also an object of type state
        Here a simple template for a boolean variable named 'testVariable'
        Because every adapter instance uses its own unique namespace variable names can't collide with other adapters variables
    */
    // await adapter.setObjectNotExistsAsync('testVariable', {
    //     type: 'state',
    //     common: {
    //         name: 'testVariable',
    //         type: 'boolean',
    //         role: 'indicator',
    //         read: true,
    //         write: true,
    //     },
    //     native: {},
    // });

    // In order to get state updates, you need to subscribe to them. The following line adds a subscription for our variable we have created above.
    // adapter.subscribeStates('testVariable');
    // You can also add a subscription for multiple states. The following line watches all states starting with 'lights.'
    // adapter.subscribeStates('lights.*');
    // Or, if you really must, you can also watch all states. Don't do this if you don't need to. Otherwise this will cause a lot of unnecessary load on the system:
    // adapter.subscribeStates('*');

    /*
        setState examples
        you will notice that each setState will cause the stateChange event to fire (because of above subscribeStates cmd)
    */
    // the variable testVariable is set to true as command (ack=false)
    // await adapter.setStateAsync('testVariable', true);

    // same thing, but the value is flagged 'ack'
    // ack should be always set to true if the value is received from or acknowledged from the target system
    // await adapter.setStateAsync('testVariable', { val: true, ack: true });

    // same thing, but the state is deleted after 30s (getState will return null afterwards)
    // await adapter.setStateAsync('testVariable', { val: true, ack: true, expire: 30 });

    // examples for the checkPassword/checkGroup functions
    // adapter.checkPassword('admin', 'iobroker', (res) => {
    //     adapter.log.info('check user admin pw iobroker: ' + res);
    // });

    // adapter.checkGroup('admin', 'admin', (res) => {
    //     adapter.log.info('check group user admin group admin: ' + res);
    // });
    txSocket = dgram.createSocket('udp4');

    rxSocketReports = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    rxSocketReports.on('error', (err) => {
        adapter.log.error('RxSocketReports error: ' + err.message + '\n' + err.stack);
        rxSocketReports.close();
    });
    rxSocketReports.on('listening', function () {
        rxSocketReports.setBroadcast(true);
        const address = rxSocketReports.address();
        adapter.log.debug('UDP server listening on ' + address.address + ':' + address.port);
    });
    rxSocketReports.on('message', handleWallboxMessage);
    rxSocketReports.bind(DEFAULT_UDP_PORT, '0.0.0.0');

    rxSocketBroadcast = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    rxSocketBroadcast.on('error', (err) => {
        adapter.log.error('RxSocketBroadcast error: ' + err.message + '\n' + err.stack);
        rxSocketBroadcast.close();
    });
    rxSocketBroadcast.on('listening', function () {
        rxSocketBroadcast.setBroadcast(true);
        rxSocketBroadcast.setMulticastLoopback(true);
        const address = rxSocketBroadcast.address();
        adapter.log.debug('UDP broadcast server listening on ' + address.address + ':' + address.port);
    });
    rxSocketBroadcast.on('message', handleWallboxBroadcast);
    rxSocketBroadcast.bind(BROADCAST_UDP_PORT);

    //await adapter.setStateAsync('info.connection', true, true);  // too ealry to acknowledge ...

    adapter.getForeignObject('system.config', function(err, ioBroker_Settings) {
        if (err) {
            adapter.log.error('Error while fetching system.config: ' + err);
            return;
        }

        if (ioBroker_Settings && (ioBroker_Settings.common.language == 'de')) {
            ioBrokerLanguage = 'de';
        } else {
            ioBrokerLanguage = 'en';
        }
    });

    adapter.getStatesOf(function (err, data) {
        if (data) {
            for (let i = 0; i < data.length; i++) {
                if (data[i].native && data[i].native.udpKey) {
                    states[data[i].native.udpKey] = data[i];
                }
            }
        }
        // save all state value into internal store
        adapter.getStates('*', function (err, obj) {
            if (err) {
                adapter.log.error('error reading states: ' + err);
            } else {
                if (obj) {
                    for (const i in obj) {
                        if (! Object.prototype.hasOwnProperty.call(obj, i)) continue;
                        if (obj[i] !== null) {
                            if (typeof obj[i] == 'object') {
                                setStateInternal(i, obj[i].val);
                            } else {
                                adapter.log.error('unexpected state value: ' + obj[i]);
                            }
                        }
                    }
                } else {
                    adapter.log.error('not states found');
                }
            }
        });
        start();
    });
}


/**
 * Function is called at the end of main function and will add the subscribed functions
 * of all the states of the dapter.
 */
function start() {
    adapter.subscribeStates('*');

    stateChangeListeners[adapter.namespace + '.' + stateWallboxEnabled] = function (oldValue, newValue) {
        sendUdpDatagram('ena ' + (newValue ? 1 : 0), true);
    };
    stateChangeListeners[adapter.namespace + '.' + stateWallboxCurrent] = function (oldValue, newValue) {
        //sendUdpDatagram('currtime ' + parseInt(newValue) + ' 1', true);
        sendUdpDatagram('curr ' + parseInt(newValue), true);
    };
    stateChangeListeners[adapter.namespace + '.' + stateWallboxOutput] = function (oldValue, newValue) {
        sendUdpDatagram('output ' + (newValue ? 1 : 0), true);
    };
    stateChangeListeners[adapter.namespace + '.' + stateWallboxDisplay] = function (oldValue, newValue) {
        if (newValue !== null) {
            if (typeof newValue == 'string') {
                sendUdpDatagram('display 0 0 0 0 ' + newValue.replace(/ /g, '$'), true);
            } else {
                adapter.log.error('invalid data to send to display: ' + newValue);
            }
        }
    };
    stateChangeListeners[adapter.namespace + '.' + stateWallboxDisabled] = function () {
        // parameters (oldValue, newValue) can be ommited if not needed
        // no real action to do
    };
    stateChangeListeners[adapter.namespace + '.' + statePvAutomatic] = function () {
        // no real action to do
    };
    stateChangeListeners[adapter.namespace + '.' + stateSetEnergy] = function (oldValue, newValue) {
        sendUdpDatagram('setenergy ' + parseInt(newValue) * 10, true);
    };
    stateChangeListeners[adapter.namespace + '.' + stateReport] = function (oldValue, newValue) {
        sendUdpDatagram('report ' + newValue, true);
    };
    stateChangeListeners[adapter.namespace + '.' + stateStart] = function (oldValue, newValue) {
        sendUdpDatagram('start ' + newValue, true);
    };
    stateChangeListeners[adapter.namespace + '.' + stateStop] = function (oldValue, newValue) {
        sendUdpDatagram('stop ' + newValue, true);
    };
    stateChangeListeners[adapter.namespace + '.' + stateSetDateTime] = function (oldValue, newValue) {
        sendUdpDatagram('setdatetime ' + newValue, true);
    };
    stateChangeListeners[adapter.namespace + '.' + stateUnlock] = function () {
        sendUdpDatagram('unlock', true);
    };
    stateChangeListeners[adapter.namespace + '.' + stateX2Source] = function (oldValue, newValue) {
        sendUdpDatagram('x2src ' + newValue, true);
    };
    stateChangeListeners[adapter.namespace + '.' + stateX2Switch] = function (oldValue, newValue) {
        sendUdpDatagram('x2 ' + newValue, true);
        setStateAck(state1p3pSwTimestamp, new Date().toString());
    };
    stateChangeListeners[adapter.namespace + '.' + stateAddPower] = function () {
        // no real action to do
    };
    stateChangeListeners[adapter.namespace + '.' + stateManualPhases] = function () {
        // no real action to do
    };
    stateChangeListeners[adapter.namespace + '.' + stateLimitCurrent] = function () {
        // no real action to do
    };
    stateChangeListeners[adapter.namespace + '.' + stateBatteryStrategy] = function () {
        // no real action to do
    };
    stateChangeListeners[adapter.namespace + '.' + stateMsgFromOtherwallbox] = function (oldValue, newValue) {
        handleWallboxExchange(newValue);
    };
    stateChangeListeners[adapter.namespace + '.' + stateMinimumSoCOfBatteryStorage] = function (_oldValue, _newValue) {
        // no real action to do
    };

    //sendUdpDatagram('i');   only needed for discovery
    requestReports();
    enableChargingTimer((isPassive) ? intervalPassiveUpdate : intervalActiceUpdate);
}

/**
 * Function which checks weahter the state given by the parameter is defined in the adapter.config page.
 * @param {string} stateValue is a string with the value of the state.
 * @returns {*} true if the tate is specified.
 */
function isForeignStateSpecified(stateValue) {
    return stateValue && stateValue !== null && typeof stateValue == 'string' && stateValue !== '' && stateValue !== '[object Object]';
}


/**
 * Function calls addForeignState which subscribes a foreign state to write values
 * in 'currentStateValues'
 * @param {string} stateValue is a string with the value of the state.
 * @returns {boolean} returns true if the function addForeingnState was executed successful
 */
function addForeignStateFromConfig(stateValue) {
    if (isForeignStateSpecified(stateValue)) {
        if (addForeignState(stateValue)) {
            return true;
        } else {
            adapter.log.error('Error when adding foreign state "' + stateValue + '"');
            return false;
        }
    }
    return true;
}

/**
 * Function is called by onAdapterReady. Check if config data is fine for adapter start
 * @returns {boolean} returns true if everything is fine
 */
function checkConfig() {
    let everythingFine = true;
    if (adapter.config.host == '0.0.0.0' || adapter.config.host == '127.0.0.1') {
        adapter.log.warn('Can\'t start adapter for invalid IP address: ' + adapter.config.host);
        everythingFine = false;
    }
    if (adapter.config.loadChargingSessions == true) {
        loadChargingSessions = true;
    }
    isPassive = false;
    if (adapter.config.passiveMode) {
        isPassive = true;
        if (everythingFine) {
            adapter.log.info('starting charging station in passive mode');
        }
    }
    if (isPassive) {
        if (adapter.config.pollInterval > 0) {
            intervalPassiveUpdate = getNumber(adapter.config.pollInterval) * 1000;
        }
    } else {
        isPassive = false;
        if (everythingFine) {
            adapter.log.info('starting charging station in active mode');
        }
    }
    if (isForeignStateSpecified(adapter.config.stateRegard)) {
        photovoltaicsActive = true;
        everythingFine = addForeignStateFromConfig(adapter.config.stateRegard) && everythingFine;
    }
    if (isForeignStateSpecified(adapter.config.stateSurplus)) {
        photovoltaicsActive = true;
        everythingFine = addForeignStateFromConfig(adapter.config.stateSurplus) && everythingFine;
    }
    if (photovoltaicsActive) {
        everythingFine = init1p3pSwitching(adapter.config.state1p3pSwitch) && everythingFine;
        if (isX2PhaseSwitch()) {
            if (isForeignStateSpecified(adapter.config.state1p3pSwitch)) {
                everythingFine = false;
                adapter.log.error('both, state for 1p/3p switch and switching via X2, must not be specified together');
            }
            const valueOn = 1;
            const valueOff = 0;
            valueFor1p3pOff = valueOff;
            if (adapter.config['1p3pSwitchIsNO'] === true) {
                valueFor1pCharging = valueOff;
                valueFor3pCharging = valueOn;
            } else {
                valueFor1pCharging = valueOn;
                valueFor3pCharging = valueOff;
            }

            min1p3pSwSec = 305;
            adapter.log.info('Using min time between phase switching of: ' +min1p3pSwSec);
        }

        everythingFine = addForeignStateFromConfig(adapter.config.stateBatteryCharging) && everythingFine;
        everythingFine = addForeignStateFromConfig(adapter.config.stateBatteryDischarging) && everythingFine;
        everythingFine = addForeignStateFromConfig(adapter.config.stateBatterySoC) && everythingFine;
        if ((isForeignStateSpecified(adapter.config.stateBatteryCharging) ||
            isForeignStateSpecified(adapter.config.stateBatteryDischarging) ||
            adapter.config.batteryPower > 0)) {
            batteryStrategy = adapter.config.batteryStorageStrategy;
        }
        if (adapter.config.useX1forAutomatic) {
            useX1switchForAutomatic = true;
        } else {
            useX1switchForAutomatic = false;
        }
        if (! adapter.config.delta || adapter.config.delta <= 50) {
            adapter.log.info('amperage delta not speficied or too low, using default value of ' + amperageDelta);
        } else {
            amperageDelta = getNumber(adapter.config.delta);
        }
        if (! adapter.config.minAmperage || adapter.config.minAmperage == 0) {
            adapter.log.info('using default minimum amperage of ' + minAmperageDefault);
            minAmperage = minAmperageDefault;
        } else if (adapter.config.minAmperage < minAmperage) {
            adapter.log.info('minimum amperage not speficied or too low, using default value of ' + minAmperage);
        } else {
            minAmperage = getNumber(adapter.config.minAmperage);
        }
        if (adapter.config.addPower !== 0) {
            setStateAck(stateAddPower, getNumber(adapter.config.addPower));
        }
        if (adapter.config.underusage !== 0) {
            underusage = getNumber(adapter.config.underusage);
        }
        if (! adapter.config.minTime || adapter.config.minTime < 0) {
            adapter.log.info('minimum charge time not speficied or too low, using default value of ' + minChargeSeconds);
        } else {
            minChargeSeconds = getNumber(adapter.config.minTime);
        }
        if (! adapter.config.regardTime || adapter.config.regardTime < 0) {
            adapter.log.info('minimum regard time not speficied or too low, using default value of ' + minRegardSeconds);
        } else {
            minRegardSeconds = getNumber(adapter.config.regardTime);
        }
    }
    if (adapter.config.maxPower && (adapter.config.maxPower != 0)) {
        maxPowerActive = true;
        if (adapter.config.maxPower <= 0) {
            adapter.log.warn('max. power negative or zero - power limitation deactivated');
            maxPowerActive = false;
        }
    }
    if (maxPowerActive) {
        everythingFine = addForeignStateFromConfig(adapter.config.stateEnergyMeter1) && everythingFine;
        everythingFine = addForeignStateFromConfig(adapter.config.stateEnergyMeter2) && everythingFine;
        everythingFine = addForeignStateFromConfig(adapter.config.stateEnergyMeter3) && everythingFine;
        if (adapter.config.wallboxNotIncluded) {
            wallboxIncluded = false;
        } else {
            wallboxIncluded = true;
        }
        if (everythingFine) {
            if (! (adapter.config.stateEnergyMeter1 || adapter.config.stateEnergyMeter2 || adapter.config.stateEnergyMeter1)) {
                adapter.log.error('no energy meters defined - power limitation deactivated');
                maxPowerActive = false;
            }
        }
    }
    return everythingFine;
}

function init1p3pSwitching(stateNameFor1p3p) {
    if (! isForeignStateSpecified(stateNameFor1p3p)) {
        return true;
    }
    if (! addForeignStateFromConfig(stateNameFor1p3p)) {
        return false;
    }
    adapter.getForeignState(stateNameFor1p3p, function (err, obj) {
        if (err) {
            adapter.log.error('error reading state ' + stateNameFor1p3p + ': ' + err);
            return;
        } else {
            if (obj) {
                stateFor1p3pCharging = stateNameFor1p3p;
                let valueOn;
                let valueOff;
                if (typeof obj.val == 'boolean') {
                    valueOn = true;
                    valueOff = false;
                } else if (typeof obj.val == 'number') {
                    valueOn = 1;
                    valueOff = 0;
                } else {
                    adapter.log.error('unhandled type ' + typeof obj.val + ' for state ' + stateNameFor1p3p);
                    return;
                }
                stateFor1p3pAck = obj.ack;
                valueFor1p3pOff = valueOff;
                if (adapter.config['1p3pSwitchIsNO'] === true) {
                    valueFor1pCharging = valueOff;
                    valueFor3pCharging = valueOn;
                } else {
                    valueFor1pCharging = valueOn;
                    valueFor3pCharging = valueOff;
                }
            }
            else {
                adapter.log.error('state ' + stateNameFor1p3p + ' not found!');
            }
        }
    });
    return true;
}

// subscribe a foreign state to save values in 'currentStateValues'
function addForeignState(id) {
    if (typeof id !== 'string')
        return false;
    if (id == '' || id == ' ')
        return false;
    adapter.getForeignState(id, function (err, obj) {
        if (err) {
            adapter.log.error('error subscribing ' + id + ': ' + err);
        } else {
            if (obj) {
                adapter.log.debug('subscribe state ' + id + ' - current value: ' + obj.val);
                setStateInternal(id, obj.val);
                adapter.subscribeForeignStates(id); // there's no return value (success, ...)
                //adapter.subscribeForeignStates({id: id, change: 'ne'}); // condition is not working
            }
            else {
                adapter.log.error('state ' + id + ' not found!');
            }
        }
    });
    return true;
}

function isMessageFromWallboxOfThisInstance(remote) {
    return (remote.address == adapter.config.host);
}

function sendMessageToOtherInstance(message, remote) {
    // save message for other instances by setting value into state
    const prefix = 'system.adapter.';
    const adapterpart = adapter.name + '.';
    const suffix = '.uptime';
    adapter.getForeignObjects(prefix + adapterpart + '*' + suffix, function(err, objects) {
        if (err) {
            adapter.log.error('Error while fetching other instances: ' + err);
            return;
        }
        if (objects) {
            for (const item in objects) {
                if (Object.prototype.hasOwnProperty.call(objects, item) && item.endsWith(suffix)) {
                    const namespace = item.slice(prefix.length, - suffix.length);
                    adapter.getForeignObject(prefix + namespace, function(err, object) {
                        if (err) {
                            adapter.log.error('Error while fetching other instances: ' + err);
                            return;
                        }
                        if (object) {
                            if (Object.prototype.hasOwnProperty.call(object, 'native')) {
                                if (Object.prototype.hasOwnProperty.call(object.native, 'host')) {
                                    if (object.native.host == remote.address) {
                                        adapter.setForeignState(namespace + '.' + stateMsgFromOtherwallbox, message.toString().trim());
                                        adapter.log.debug('Message from ' + remote.address + ' send to ' + namespace);
                                    }
                                }
                            }
                        }
                    });
                }
            }
        }
    });
}

// handle incomming message from wallbox
function handleWallboxMessage(message, remote) {
    adapter.log.debug('UDP datagram from ' + remote.address + ':' + remote.port + ': "' + message + '"');
    if (isMessageFromWallboxOfThisInstance(remote)) {     // handle only message from wallbox linked to this instance, ignore other wallboxes sending broadcasts
        // Mark that connection is established by incomming data
        handleMessage(message, 'received');
    } else {
        sendMessageToOtherInstance(message, remote);
    }
}

// handle incomming broadcast message from wallbox
function handleWallboxBroadcast(message, remote) {
    adapter.log.debug('UDP broadcast datagram from ' + remote.address + ':' + remote.port + ': "' + message + '"');
    if (isMessageFromWallboxOfThisInstance(remote)) {     // handle only message from wallbox linked to this instance, ignore other wallboxes sending broadcasts
        handleMessage(message, 'broadcast');
    }
}

// handle incomming message from other instance for this wallbox
function handleWallboxExchange(message) {
    adapter.log.debug('datagram from other instance: "' + message + '"');
    handleMessage(message, 'instance');
}

function handleMessage(message, origin) {
    // Mark that connection is established by incomming data
    adapter.setState('info.connection', true, true);
    let msg = '';
    try {
        msg = message.toString().trim();
        if (msg.length === 0) {
            return;
        }

        if (msg == 'started ...') {
            adapter.log.info('Wallbox startup complete');
            return;
        }

        if (msg == 'i') {
            adapter.log.debug('Received: ' + message);
            return;
        }

        if (msg.startsWith('TCH-OK')) {
            adapter.log.debug('Received ' + message);
            return;
        }

        if (msg.startsWith('TCH-ERR')) {
            adapter.log.error('Error received from wallbox: ' + message);
            return;
        }

        if (msg[0] == '"') {
            msg = '{ ' + msg + ' }';
        }

        handleJsonMessage(JSON.parse(msg));
    } catch (e) {
        adapter.log.warn('Error handling ' + origin + ' message: ' + e + ' (' + msg + ')');
        return;
    }

}

async function handleJsonMessage(message) {
    // message auf ID Kennung für Session History prüfen
    if (message.ID >= 100 && message.ID <= 130) {
        adapter.log.debug('History ID received: ' + message.ID.substr(1));
        const sessionid = message.ID.substr(1);
        if (loadChargingSessions) {
            updateState(states[sessionid + '_json'], JSON.stringify([message]));
        }
        for (const key in message){
            if (states[sessionid + '_' + key] || loadChargingSessions === false) {
                try {
                    if (message.ID == 100) {
                        // process some values of current charging session
                        switch (key) {
                            case 'Session ID': setStateAck(stateSessionId, message[key]); break;
                            case 'RFID tag': setStateAck(stateRfidTag, message[key]); break;
                            case 'RFID class': setStateAck(stateRfidClass, message[key]); break;
                        }
                    }
                    if (loadChargingSessions) {
                        updateState(states[sessionid + '_' + key], message[key]);
                    }
                } catch (e) {
                    adapter.log.warn('Couldn"t update state ' + 'Session_' + sessionid + '.' + key + ': ' + e);
                }
            } else if (key != 'ID'){
                adapter.log.warn('Unknown Session value received: ' + key + '=' + message[key]);
            }
        }
    } else {
        for (const key in message) {
            if (states[key]) {
                try {
                    await updateState(states[key], message[key]);
                    if (key == 'X2 phaseSwitch source' && isX2PhaseSwitch()) {
                        const currentValue = getStateDefault0(states[key]._id);
                        if (currentValue !== 4) {
                            adapter.log.info('activating X2 source from ' + currentValue + ' to 4 for phase switching');
                            sendUdpDatagram('x2src 4', true);
                        }
                    }
                } catch (e) {
                    adapter.log.warn('Couldn"t update state ' + key + ': ' + e);
                }
            } else if (key != 'ID') {
                adapter.log.warn('Unknown value received: ' + key + '=' + message[key]);
            }
        }
        if (message.ID == 3) {
            // Do calculation after processing 'report 3'
            checkWallboxPower();
        }
    }
}

/**
 * Return battery storage strategy to be used (from state or from settings)
 * @returns {number} number of strategy (1-4) or 0 if none
 */
function getBatteryStorageStrategy() {
    const strategy = getStateDefault0(stateBatteryStrategy);
    if (strategy > 0) {
        return strategy;
    }
    return batteryStrategy;
}


/**
 * Return whether battery is not to be used and vehicle is priorized
 * @returns {boolean} true if this mode is activated
 */
function isNotUsingBatteryWithPrioOnVehicle() {
    return getBatteryStorageStrategy() == 1;

}

/**
 * Return whether battery is not to be used and battery is priorized before vehicle
 * @returns {boolean} true if this mode is activated
 */
function isNotUsingBatteryWithPrioOnBattery() {
    return getBatteryStorageStrategy() == 2;

}

/**
 * Return whether battery is not to be used and vehicle is priorized
 * @returns {boolean} true if this mode is activated
 */
function isUsingBatteryForMinimumChargingOfVehicle() {
    return getBatteryStorageStrategy() == 3;
}

/**
 * Return whether battery is not to be used and vehicle is priorized
 * @returns {boolean} true if this mode is activated
 */
function isUsingBatteryForFullChargingOfVehicle() {
    return getBatteryStorageStrategy() == 4;
}

/**
 * Get the minimum current for wallbox
 * @returns {number} the  minimum amperage to start charging session
 */
function getMinCurrent() {
    return minAmperage;
}

/**
 * Get maximum current for wallbox (hardware defined by dip switch) min. of stateWallboxMaxCurrent an stateLimitCurrent
 * @returns {number} the  maxium allowed charging current
 */
function getMaxCurrent() {
    let max = getStateDefault0(stateWallboxMaxCurrent);
    const limit = getStateDefault0(stateLimitCurrent);
    if ((limit > 0) && (limit < max)) {
        max = limit;
    }
    return max;
}

function resetChargingSessionData() {
    setStateAck(stateChargeTimestamp, null);
    setStateAck(stateRegardTimestamp, null);
}

function saveChargingSessionData() {
    const plugTimestamp = getStateAsDate(statePlugTimestamp);
    if (plugTimestamp == null) {
        setStateAck(stateLastChargeStart, null);
    } else {
        setStateAck(stateLastChargeStart, plugTimestamp.toString());
    }
    setStateAck(stateLastChargeFinish, (new Date()).toString());
    setStateAck(stateLastChargeAmount, getStateDefault0(stateWallboxChargeAmount) / 1000);
}

function stopCharging() {
    regulateWallbox(0);
    resetChargingSessionData();
}

function regulateWallbox(milliAmpere) {
    let oldValue = 0;
    if (getStateDefaultFalse(stateWallboxEnabled) || (getStateDefault0(stateWallboxState) == 3)) {
        oldValue = getStateDefault0(stateWallboxCurrent);
    }

    if (isNoChargingDueToInterupptedStateOfWallbox(milliAmpere)) {
        if (milliAmpere > 0) {
            adapter.log.debug('No charging due to interupted charging station');
        }
        milliAmpere = 0;
    }

    if (milliAmpere != oldValue) {
        if (milliAmpere == 0) {
            adapter.log.info('stop charging');
        } else if (oldValue == 0) {
            adapter.log.info('(re)start charging with ' + milliAmpere + 'mA' + ((isMaxPowerCalculation) ? ' (maxPower)' : ''));
        } else {
            adapter.log.info('regulate wallbox from ' + oldValue + ' to ' + milliAmpere + 'mA' + ((isMaxPowerCalculation) ? ' (maxPower)' : ''));
        }
        sendUdpDatagram('currtime ' + milliAmpere + ' 1', true);
    }
}

function initChargingSession() {
    resetChargingSessionData();
    setStateAck(statePlugTimestamp, new Date().toString());
    setStateAck(stateSessionId, null);
    setStateAck(stateRfidTag, null);
    setStateAck(stateRfidClass, null);
    displayChargeMode();
}

function finishChargingSession() {
    saveChargingSessionData();
    setStateAck(statePlugTimestamp, null);
    resetChargingSessionData();
}

/**
 * Return the amount of watts used for charging. Value is calculated for TYPE_D_EDITION wallbox and returned by the box itself for others.
 * @returns {number} the power in watts, with which the wallbox is currently charging.
 */
function getWallboxPowerInWatts() {
    if (getWallboxType() == TYPE_D_EDITION) {
        if (isVehiclePlugged() && (getStateDefault0(stateWallboxState) == 3)) {

            return getStateDefault0(stateWallboxCurrent) * voltage * getChargingPhaseCount() / 1000;
        } else {
            return 0;
        }
    } else {
        return getStateDefault0(stateWallboxPower) / 1000;
    }
}

/**
 * Get minimum SoC of battery storage above which it may be used for charging vehicle
 * @returns {number} SoC
 */
function getMinimumBatteryStorageSocForCharging() {
    const dynamicValue = getStateDefault0(stateMinimumSoCOfBatteryStorage);
    const fixValue = adapter.config.batteryMinSoC;
    let value;
    if (dynamicValue > 0 && dynamicValue >= fixValue) {
        value = dynamicValue;
    } else {
        value = fixValue;
    }
    if (value > 0 && value <= 100) {
        return value;
    }
    return 0;
}

/**
 * Get delta to add to available power to ignore battery power (fullPowerRequested == false) or to work with surplus plus power
 * of battery storage.
 *
 * @param {boolean} isFullPowerRequested if checked then maximum available power of battery storage will be returned
 * @returns {number} delta to be added to surplus for available power for charging vehicle.
 */
function getBatteryStoragePower(isFullPowerRequested) {
    // Beispiel: Surplus = 2000W
    // Batterie entladen mit 1000W
    // Max. Leistung Batterie: 2500W
    const batteryPower = getStateDefault0(adapter.config.stateBatteryCharging) - getStateDefault0(adapter.config.stateBatteryDischarging);
    if (isNotUsingBatteryWithPrioOnBattery()) {
        if (batteryPower > 0) {
            return 0;
        }
    } else if (isNotUsingBatteryWithPrioOnVehicle() ||
            (isUsingBatteryForMinimumChargingOfVehicle() && isFullPowerRequested == false)) {
        return batteryPower;
    } else if (isUsingBatteryForFullChargingOfVehicle() ||
            (isUsingBatteryForMinimumChargingOfVehicle() && isFullPowerRequested == true)) {
        const maxBatteryPower = (getStateDefault0(adapter.config.stateBatterySoC) > getMinimumBatteryStorageSocForCharging()) ? adapter.config.batteryPower : 0;
        return maxBatteryPower + batteryPower;
    } else {
        return 0;
    }
    return batteryPower;
}

/**
 * The available surplus is calculated and returned not considering the used power for charging. If configured the availabe storage power is added.
 *
 * @param {boolean} isFullBatteryStoragePowerRequested if checked then maximum available power of the battery is added
 * @returns {number} the available surplus without considering the wallbox power currently used for charging.
 */
function getSurplusWithoutWallbox(isFullBatteryStoragePowerRequested = false) {
    let power = getStateDefault0(adapter.config.stateSurplus) - getStateDefault0(adapter.config.stateRegard) + getBatteryStoragePower(isFullBatteryStoragePowerRequested);
    if (adapter.config.statesIncludeWallbox) {
        power += getWallboxPowerInWatts();
    }
    return power;
}

/**
 * The available totoal power is calculated base on EnergyMeters without wallbox power.
 * @returns {number} the available power in watts not including the wallbox power itself.
 */
function getTotalPower() {
    let result = getStateDefault0(adapter.config.stateEnergyMeter1)
               + getStateDefault0(adapter.config.stateEnergyMeter2)
               + getStateDefault0(adapter.config.stateEnergyMeter3);
    if (wallboxIncluded) {
        result -= getWallboxPowerInWatts();
    }
    return result;
}


/**
 * If the maximum power available is defined and max power limitation is active a reduced value is return, otherwise no real limit.
 * @returns the total power available
 */
function getTotalPowerAvailable() {
    // Wenn keine Leistungsbegrenzung eingestelt ist, dann max. liefern
    if (maxPowerActive && (adapter.config.maxPower > 0)) {
        return adapter.config.maxPower - getTotalPower();
    }
    return 999999;  // return default maximum
}

/**
 * resets values for 1p/3p switching
 */
function reset1p3pSwitching() {
    stepFor1p3pSwitching = 0;
    retries1p3pSwitching = 0;
}

/**
 * Advances variables to next step of 1p/3p switching
 */
function doNextStepOf1p3pSwitching() {
    stepFor1p3pSwitching ++;
    retries1p3pSwitching = 0;
}

/**
 * Returns whether phase switching is done via X2 of charging station
 * @returns true, if switch is done via X2
 *
 */
function isX2PhaseSwitch() {
    return adapter.config['1p3pViaX2'] == true;
}

/**
 * set a new value for 1p/3p switching. Ignored, if not active.
 * @param {*} newValue new value for 1p/3p switch
 * @returns {boolean} true, if switching is in progress, false when nothing to do
 */
function set1p3pSwitching(newValue) {
    if (! has1P3PAutomatic() || stepFor1p3pSwitching < 0) {
        return false;
    }
    if (newValue !== null) {
        if (isX2PhaseSwitch()) {
            if (newValue != getStateDefault0(stateX2Switch)) {
                setStateAck(state1p3pSwTimestamp, new Date().toString());
                adapter.log.info('updating X2 for switch of phases from ' + getStateDefault0(stateX2Switch) + ' to ' + newValue + '...');
                sendUdpDatagram('x2 ' + newValue, true);
            }
        } else {
            if (newValue !== getStateInternal(stateFor1p3pCharging)) {
                if (newValue !== valueFor1p3pSwitching) {
                    stepFor1p3pSwitching = 1;
                    valueFor1p3pSwitching = newValue;
                }
            }
        }
    }
    return check1p3pSwitching();
}

/**
 * Checks whether it's ok to proceed or processing should stop to wait for 1p/3p switching.
 * @returns {boolean} true, if switching is in progress, false when nothing to do
 */
function check1p3pSwitching() {
    if (! has1P3PAutomatic() || isX2PhaseSwitch()) {
        if (stepFor1p3pSwitching >= 0) {
            reset1p3pSwitching();  // don't reset -1 value
        }
        return false;
    }
    if (stepFor1p3pSwitching <= 0) {
        return false;
    }
    switch (stepFor1p3pSwitching) {
        case 1:
            if (isVehicleCharging()) {
                if (retries1p3pSwitching == 0) {
                    adapter.log.info('stop charging for switch of phases ...');
                    stopCharging();
                } else {
                    check1p3pSwitchingRetries();
                }
                return true;
            }
            doNextStepOf1p3pSwitching();
            // falls through
        case 2:
            if (valueFor1p3pSwitching !== getStateInternal(stateFor1p3pCharging)) {
                stateFor1p3pAck = false;
                adapter.log.info('switching 1p3p to ' + valueFor1p3pSwitching + ' ...');
                adapter.setForeignState(stateFor1p3pCharging, valueFor1p3pSwitching);
                doNextStepOf1p3pSwitching();
                return true;
            }
            doNextStepOf1p3pSwitching();
            // falls through
        case 3:
            if (! stateFor1p3pAck) {
                check1p3pSwitchingRetries();
                return true;
            }
            reset1p3pSwitching();
            adapter.log.info('switch 1p/3p successfully completed.');
            break;
        default:
            adapter.log.error('unknown step for 1p/3p switching: ' + stepFor1p3pSwitching);
            reset1p3pSwitching();
    }
    return false;
}

/**
 * Return the current for 1 phase to switch to 3 phases charging (lower when only 2 phases in effect for charging)
 * @returns {number} current from which to switch to 3p in mA
 */
function getCurrentForSwitchTo3p() {  
    adapter.log.warn('getMinCurrent: ' + getMinCurrent());
    adapter.log.warn('get1p3pPhases: ' + get1p3pPhases());
    return  getMinCurrent() * get1p3pPhases() * 1.10;
}

/**
 * Is adapter configured to be able to switch between 1 and 3 phases charging
 * @returns {boolean} true, if it is possible to switch 1p/3p
 */
function has1P3PAutomatic() {
    return stepFor1p3pSwitching >= 0 && (stateFor1p3pCharging !== null || isX2PhaseSwitch());
}

/**
 * returns whether charging was switched to 1p and more than 1 phase is available for charging
 * @returns {boolean} true, if charging was switched to 1p and more than 1 phase is available for charging
 */
function isReducedChargingBecause1p3p() {
    if (! has1P3PAutomatic() || stepFor1p3pSwitching < 0) {
        return false;
    }
    let currentSwitch;
    if (isX2PhaseSwitch()) {
        currentSwitch = getStateDefault0(stateX2Switch);
    } else {
        currentSwitch = getStateInternal(stateFor1p3pCharging);
    }
    if (currentSwitch === valueFor1pCharging) {
        return true;
    }
    if (currentSwitch === valueFor3pCharging) {
        return false;
    }
    adapter.log.warn('Invalid value for 1p3p switch: ' + currentSwitch + ' (type ' + typeof currentSwitch + ')');
    return false;
}

/**
 * Return the number of phases currently possible if no switch to 1p would be in progress
 * @returns {number} number of phases for charging of 3p would be in effect
 */
function get1p3pPhases() {
    if (isReducedChargingBecause1p3p()) {
        let phases = getStateDefault0(stateChargingPhases);
        if (isVehicleCharging() && phases > 1 && getChargingPhaseCount() > 1) {
            adapter.log.error('Charging with ' + phases + ' but reduced (1p) expected, disabling 1p/3p switch for this charging session');
            reset1p3pSwitching();
            stepFor1p3pSwitching = -1;
        }
        if (phases <= 0) {
            phases = getStateDefault0(stateManualPhases);
        }
        if (phases <= 0) {
            phases = 1;
        }
        if (phases > 3) {
            phases = 3;
        }
        return phases;
    }
    return getChargingPhaseCount();
}


/**
 * Return the number of phases currently used for charging
 * @returns number of phases recognized for charging.
 */
function getChargingPhaseCount() {
    let retVal = getStateDefault0(stateChargingPhases);
    if ((getWallboxType() == TYPE_D_EDITION) || (retVal == 0)) {
        if (isReducedChargingBecause1p3p()) {
            retVal = 1;
        } else {
            retVal = getStateDefault0(stateManualPhases);
            if (retVal < 0) {
                adapter.log.warn('invalid manual phases count ' + retVal + ' using 1 phases');
                retVal = 1;
            }
            if (retVal > 3) {
                adapter.log.warn('invalid manual phases count ' + retVal + ' using 3 phases');
                retVal = 3;
            }
        }
    }

    // Number of phaes can only be calculated if vehicle is charging
    if ((getWallboxType() != TYPE_D_EDITION) && isVehicleCharging()) {
        let tempCount = 0;
        if (getStateDefault0(stateWallboxPhase1) > 250) {
            tempCount ++;
        }
        if (getStateDefault0(stateWallboxPhase2) > 250) {
            tempCount ++;
        }
        if (getStateDefault0(stateWallboxPhase3) > 250) {
            tempCount ++;
        }
        if (tempCount > 0) {
            // save phase count and write info message if changed
            if (retVal != tempCount)
                adapter.log.debug('wallbox is charging with ' + tempCount + ' ' + ((tempCount == 1) ? 'phase' : 'phases'));
            if (! isReducedChargingBecause1p3p()) {
                setStateAck(stateChargingPhases, tempCount);
            }
            retVal = tempCount;
        } else {
            adapter.log.warn('wallbox is charging but no phases where recognized');
        }
    }
    // if no phases where detected then calculate with one phase
    if (retVal <= 0) {
        adapter.log.debug('setting phase count to 1');
        retVal = 1;
    }
    adapter.log.silly('currently charging with ' + retVal + ' phases');
    return retVal;
}

/**
 * Returns the status true if the WallboxPowerinWatts is bigger then 1000W
 * @returns true if the vehicle is charing based on getWallboxPowerInWatts
 */
function isVehicleCharging() {
    return getWallboxPowerInWatts() > 1000 ;
}

/**
 * Check if the vehicle is plugged. Valus is base on internal state stateWallboxPlug which is >= if vehicle is plugged.
 * @returns true if the vehicle is plugged
 */
function isVehiclePlugged(myValue) {
    let value;
    if (myValue) {
        value = myValue;
    } else {
        value = getStateInternal(stateWallboxPlug);
    }
    // 0 unplugged
    // 1 plugged on charging station
    // 3 plugged on charging station plug locked
    // 5 plugged on charging station             plugged on EV
    // 7 plugged on charging station plug locked plugged on EV
    // For wallboxes with fixed cable values of 0 and 1 not used
    // Charging only possible with value of 7
    return value >= 5;
}


/**
 * Check if the PV Automatic is currently active or not
 * @returns true if PV automatic is active
 */
function isPvAutomaticsActive() {
    if (isPassive || ! photovoltaicsActive) {
        return false;
    }
    if (useX1switchForAutomatic) {
        if (getStateDefaultFalse(stateX1input) == true) {
            return false;
        }
    }
    if (getStateDefaultFalse(statePvAutomatic))
        return true;
    else
        return false;
}

function displayChargeMode() {
    if (isPassive) {
        return;
    }
    let text;
    if (isPvAutomaticsActive())
        text = chargeTextAutomatic[ioBrokerLanguage];
    else
        text = chargeTextMax[ioBrokerLanguage];
    adapter.setState(stateWallboxDisplay, text);
}

/**
 * Returns the rounded value for charging amperage possible based on the defined power and phases given to the function.
 * @param {*} power power in Watts used for calculation
 * @param {*} phases number of phases to be used for calculation
 * @returns the values for the amperage based on amperageDelta and parameters.
 */
function getAmperage(power, phases) {
    const curr = Math.round(power / voltage * 1000 / amperageDelta / phases) * amperageDelta;
    adapter.log.debug('power: ' + power + ' / voltage: ' + voltage + ' * 1000 / delta: ' + amperageDelta + ' / phases: ' + phases + ' * delta = ' + curr);
    return curr;
}

function check1p3pSwitchingRetries() {
    if (retries1p3pSwitching >= 3) {
        adapter.log.error('switching not possible in step ' + stepFor1p3pSwitching + ', disabling 1p/3p switch for this charging session');
        reset1p3pSwitching();
        stepFor1p3pSwitching = -1;
        return true;
    }
    adapter.log.info('still waiting for 1p/3p step ' + stepFor1p3pSwitching + ' to complete...');
    retries1p3pSwitching ++;
    return false;
}

/**
 * Checks whether charging should continue because minimum charging time was not yet reached
 * @returns true if minimum charging time was not yet reached
 */
function isContinueDueToMinChargingTime(aktDate, chargeTimestamp) {
    if (minChargeSeconds <= 0 || chargeTimestamp == null) {
        return false;
    }
    if ((aktDate.getTime() - chargeTimestamp.getTime()) / 1000 < minChargeSeconds) {
        return true;
    }
    return false;
}

/**
 * Checks whether charging should continue because minimum time for charging even with regard was not yet reached
 * @returns true if minimum charging time was not yet reached
 */
function isContinueDueToMinRegardTime(aktDate) {
    if (minRegardSeconds <= 0) {
        return false;
    }
    let regardTimestamp = getStateAsDate(stateRegardTimestamp);
    if (regardTimestamp == null) {
        setStateAck(stateRegardTimestamp, aktDate.toString());
        regardTimestamp = aktDate;
    }
    if ((aktDate.getTime() - regardTimestamp.getTime()) / 1000 < minRegardSeconds) {
        return true;
    }
    return false;
}

/**
 * Checks whether switching between phases can not be performed since time has between switching is not yet reached.
 * @returns true if minimum time between switching phased was not yet reached
 */
function isContinueDueToMin1p3pSwTime(aktDate) {
    if (min1p3pSwSec <= 0) {
        return false;
    }
    const sw1p3pDate = getStateAsDate(state1p3pSwTimestamp);
    if (sw1p3pDate == null) {
        return false;
    }
    if ((aktDate.getTime() - sw1p3pDate.getTime()) / 1000 < min1p3pSwSec) {
        return true;
    }
    return false;
}

/**
 * Checks whether charging station is in state 5 (no charging due to no RFID, power limitation or conditions of vehicle).
 * After one attempt was made, no futher attempts should be done.
 * @param {number} milliAmpere  geplante Ladestromstärke
 */
function isNoChargingDueToInterupptedStateOfWallbox(milliAmpere) {
    if (milliAmpere <= 0) {
        startWithState5Attempted = false;
        return false;
    }
    if (getStateDefault0(stateWallboxState) == 5) {
        if (startWithState5Attempted == true) {
            return true;
        }
        startWithState5Attempted = false;
    } else {
        startWithState5Attempted = false;
    }
    return false;
}

function checkWallboxPower() {
    // update charging state also between two calculations to recognize charging session
    // before a new calculation will stop it again (as long as chargingTimestamp was not yet set)
    // it can be stopped immediatelly with no respect to minimim charging time...
    if (getStateAsDate(stateChargeTimestamp) === null && isVehicleCharging() && (chargingToBeStarted || isPassive)) {
        adapter.log.info('vehicle (re)starts to charge');
        setStateAck(stateChargeTimestamp, new Date().toString());
    }

    let curr    = 0;      // in mA
    let tempMax = getMaxCurrent();
    let phases = get1p3pPhases();
    isMaxPowerCalculation = false;
    chargingToBeStarted = false;

    // first of all check maximum power allowed
    if (maxPowerActive) {
        // Always calculate with three phases for safety reasons
        const maxPower = getTotalPowerAvailable();
        setStateAck(stateMaxPower, Math.round(maxPower));
        adapter.log.debug('Available max power: ' + maxPower);
        const maxAmperage = getAmperage(maxPower, phases);
        if (tempMax > maxAmperage) {
            tempMax = maxAmperage;
        }
    }

    const available = getSurplusWithoutWallbox();
    setStateAck(stateSurplus, Math.round(available));
    adapter.log.debug('Available surplus: ' + available);

    if (check1p3pSwitching()) {
        return;
    }

    if (isPassive) {
        if (getStateAsDate(stateChargeTimestamp) !== null && ! isVehicleCharging()) {
            resetChargingSessionData();
        }
        return;
    }

    const newDate = new Date();
    if (lastCalculating !== null && newDate.getTime() - lastCalculating.getTime() < intervalCalculating) {
        return;
    }

    lastCalculating = newDate;
    let newValueFor1p3pSwitching = null;

    // lock wallbox if requested or available amperage below minimum
    if (getStateDefaultFalse(stateWallboxDisabled) == true || tempMax < getMinCurrent() || (isPvAutomaticsActive() && ! isVehiclePlugged())) {
        curr = 0;
    } else {
        // if vehicle is currently charging and was not before, then save timestamp
        if (isVehiclePlugged() && isPvAutomaticsActive()) {
            curr = getAmperage(available, phases);
            if (curr > tempMax) {
                curr = tempMax;
            }
            if (isUsingBatteryForMinimumChargingOfVehicle() == true) {
                if (curr < minAmperage && isVehicleCharging() && getAmperage(getSurplusWithoutWallbox(true), phases) > minAmperage ) {
                    curr = minAmperage;
                }
            }
            const chargeTimestamp = getStateAsDate(stateChargeTimestamp);
            const Sw1p3pTimestamp = getStateAsDate(state1p3pSwTimestamp);
            const regardTimestamp = getStateAsDate(stateRegardTimestamp);
            
            adapter.log.warn('currentForSwitchTo3p: ' + getCurrentForSwitchTo3p());

            if (has1P3PAutomatic()) {
                const currWith1p = getAmperage(available, 1);
                if (curr != currWith1p) {
                    if (curr < getMinCurrent()) {
                        if (isReducedChargingBecause1p3p()) {
                            phases = 1;
                            curr = currWith1p;
                        } else {
                            if (isContinueDueToMinChargingTime(newDate, chargeTimestamp)) {
                                adapter.log.debug('no switching to 1 phase because of minimum charging time: ' + chargeTimestamp);
                            } else if (chargeTimestamp !== null && isContinueDueToMinRegardTime(newDate)) {
                                adapter.log.debug('no switching to 1 phase because of minimum regard time: ' + regardTimestamp);
                            } else if (Sw1p3pTimestamp !== null && isContinueDueToMin1p3pSwTime(newDate)) {
                                adapter.log.debug('no switching to 1 phase because of minimum time between switching: ' + Sw1p3pTimestamp);
                            } else {
                                newValueFor1p3pSwitching = valueFor1pCharging;
                                phases = 1;
                                curr = currWith1p;
                            }
                        }
                    } else {
                        if (isReducedChargingBecause1p3p()) {
                            let isSwitchFrom1pTo3P = false;
                            if (isContinueDueToMinChargingTime(newDate, chargeTimestamp)) {
                                adapter.log.debug('no switching to ' + phases + ' phases because of minimum charging time: ' + chargeTimestamp);
                            } else if (Sw1p3pTimestamp !== null && isContinueDueToMin1p3pSwTime(newDate)) {
                                adapter.log.debug('no switching to ' + phases + ' phase because of minimum time between switching: ' + Sw1p3pTimestamp);
                            } else {
                                if (currWith1p < getCurrentForSwitchTo3p()) {
                                    adapter.log.debug('no switching to ' + phases + ' phases because amperage ' + currWith1p + ' < ' + getCurrentForSwitchTo3p());
                                } else {
                                    adapter.log.debug('switching to ' + phases + ' phases because amperage ' + currWith1p + ' >= ' + getCurrentForSwitchTo3p());
                                    newValueFor1p3pSwitching = valueFor3pCharging;
                                    isSwitchFrom1pTo3P = true;
                                }
                            }
                            if (isSwitchFrom1pTo3P == false) {
                                phases = 1;
                                curr = currWith1p;
                            }
                        }
                    }
                }
            }

            const addPower = getStateDefault0(stateAddPower);
            if (curr < getMinCurrent() && addPower > 0) {
                // Reicht der Überschuss noch nicht, um zu laden, dann ggfs. zusätzlichen Netzbezug bis 'addPower' zulassen
                adapter.log.debug('check with additional power of: ' + addPower);
                if (getAmperage(available + addPower, phases) >= getMinCurrent()) {
                    adapter.log.debug('Minimum amperage reached by addPower of ' + addPower);
                    curr = getMinCurrent();
                }
            }
            if (chargeTimestamp !== null) {
                if (curr < getMinCurrent()) {
                    // if vehicle is currently charging or is allowed to do so then check limits for power off
                    if (underusage > 0) {
                        adapter.log.debug('check with additional power of: ' + addPower + ' and underUsage: ' + underusage);
                        curr = getAmperage(available + addPower + underusage, phases);
                        if (curr >= getMinCurrent()) {
                            adapter.log.info('tolerated under-usage of charge power, continuing charging session');
                            curr = getMinCurrent();
                            if (newValueFor1p3pSwitching == valueFor3pCharging) {
                                newValueFor1p3pSwitching = null;  // then also stop possible 1p to 3p switching
                            }
                        }
                    }
                }
                if (curr < getMinCurrent()) {
                    if (isContinueDueToMinChargingTime(newDate, chargeTimestamp)) {
                        adapter.log.info('minimum charge time of ' + minChargeSeconds + 'sec not reached, continuing charging session. ' + chargeTimestamp);
                        curr = getMinCurrent();
                        newValueFor1p3pSwitching = null;  // than also stop possible 1p/3p switching
                    }
                }
                if (curr < getMinCurrent()) {
                    if (isContinueDueToMinRegardTime(newDate)) {
                        adapter.log.info('minimum regard time of ' + minRegardSeconds + 'sec not reached, continuing charging session. RegardTimestamp: ' + regardTimestamp);
                        curr = getMinCurrent();
                        newValueFor1p3pSwitching = null;  // than also stop possible 1p/3p switching
                    }
                } else {
                    setStateAck(stateRegardTimestamp, null);
                }
            }
        } else {
            curr = tempMax;   // no automatic active or vehicle not plugged to wallbox? Charging with maximum power possible
            isMaxPowerCalculation = true;
            newValueFor1p3pSwitching = valueFor3pCharging;
        }
    }

    if (curr < getMinCurrent()) {
        const Sw1p3pTimestamp = getStateAsDate(state1p3pSwTimestamp);
        let currentSwitch;
        if (isX2PhaseSwitch()) {
            currentSwitch = getStateDefault0(stateX2Switch);
        } else {
            currentSwitch = getStateInternal(stateFor1p3pCharging);
        }

        if (currentSwitch === valueFor1p3pOff) {
            adapter.log.silly('switch is already in valueFor1p3pOff');
        }
        else if ((Sw1p3pTimestamp !== null && isContinueDueToMin1p3pSwTime(newDate))){
            adapter.log.debug('no switching to default phases because of minimum time between switching (stopCharging): ' +  Sw1p3pTimestamp);
        }else {
            adapter.log.debug('switching phases to default as charging is stopped');            set1p3pSwitching(valueFor1p3pOff);
        }
        adapter.log.debug('not enough power for charging ...');
        stopCharging();

    } else {
        if (newValueFor1p3pSwitching !== null) {
            if (set1p3pSwitching(newValueFor1p3pSwitching)) {
                return;
            }
        }
        if (curr > tempMax) {
            curr = tempMax;
        }
        adapter.log.debug('wallbox set to charging maximum of ' + curr + ' mA');
        regulateWallbox(curr);
        chargingToBeStarted = true;
    }
}

function disableChargingTimer() {
    if (timerDataUpdate) {
        clearInterval(timerDataUpdate);
        timerDataUpdate = null;
    }
}

function enableChargingTimer(time) {
    disableChargingTimer();
    timerDataUpdate = setInterval(requestReports, time);
}

function forceUpdateOfCalculation() {
    // disable time of last calculation to do it with next interval
    lastCalculating = null;
    requestReports();
}

function requestReports() {
    requestDeviceDataReport();
    requestChargingDataReport();
}

function requestDeviceDataReport() {
    const newDate = new Date();
    if (lastDeviceData == null || newDate.getTime() - lastDeviceData.getTime() >= intervalDeviceDataUpdate) {
        sendUdpDatagram('report 1');
        loadChargingSessionsFromWallbox();
        lastDeviceData = newDate;
    }
}

function requestChargingDataReport() {
    sendUdpDatagram('report 2');
    sendUdpDatagram('report 3');
    sendUdpDatagram('report 100');
}

function loadChargingSessionsFromWallbox() {
    if (loadChargingSessions) {
        for (let i = 101; i <= 130; i++) {
            sendUdpDatagram('report ' + i);
        }
    }
}

async function updateState(stateData, value) {
    if (stateData.common.type == 'number') {
        value = parseFloat(value);
        if (stateData.native.udpMultiplier) {
            value *= parseFloat(stateData.native.udpMultiplier);
            //Workaround for Javascript parseFloat round error for max. 2 digits after comma
            value = Math.round(value * 100) / 100;
            //
        }
    } else if (stateData.common.type == 'boolean') {
        value = parseInt(value) !== 0;
    }
    // immediately update power and amperage values to prevent that value is not yet updated by setState()
    // when doing calculation after processing report 3
    // no longer needed when using await
    //if (stateData._id == adapter.namespace + '.' + stateWallboxPower ||
    //    stateData._id == adapter.namespace + '.' + stateWallboxPhase1 ||
    //    stateData._id == adapter.namespace + '.' + stateWallboxPhase2 ||
    //    stateData._id == adapter.namespace + '.' + stateWallboxPhase3) {
    //    setStateInternal(stateData._id, value);
    //}
    await setStateAckSync(stateData._id, value);
}

function sendUdpDatagram(message, highPriority) {
    if (highPriority) {
        sendQueue.unshift(message);
    } else {
        sendQueue.push(message);
    }
    if (!sendDelayTimer) {
        sendNextQueueDatagram();
        sendDelayTimer = setInterval(sendNextQueueDatagram, 300);
    }
}

function sendNextQueueDatagram() {
    if (sendQueue.length === 0) {
        clearInterval(sendDelayTimer);
        sendDelayTimer = null;
        return;
    }
    const message = sendQueue.shift();
    if (txSocket) {
        try {
            txSocket.send(message, 0, message.length, DEFAULT_UDP_PORT, adapter.config.host, function (err) {
                // 2nd parameter 'bytes' not needed, therefore only 'err' coded
                if (err) {
                    adapter.log.warn('UDP send error for ' + adapter.config.host + ':' + DEFAULT_UDP_PORT + ': ' + err);
                    return;
                }
                adapter.log.debug('Sent "' + message + '" to ' + adapter.config.host + ':' + DEFAULT_UDP_PORT);
            });
        } catch (e) {
            if (adapter.log)
                adapter.log.error('Error sending message "' + message + '": ' + e);
        }
    }
}

function getStateInternal(id) {
    if ((id == null) || (typeof id !== 'string') || (id.trim().length == 0)) {
        return null;
    }
    let obj = id;
    if (! obj.startsWith(adapter.namespace + '.'))
        obj = adapter.namespace + '.' + id;
    return currentStateValues[obj];
}

function getNumber(value) {
    if (value) {
        if (typeof value !== 'number') {
            value = parseFloat(value);
            if (isNaN(value)) {
                value = 0;
            }
        }
        return value;
    }
    return 0;
}

function getStateAsDate(id) {
    let result = getStateInternal(id);
    // state come as timestamp string => to be converted to date object
    if (result != null) {
        result = new Date(result);
    }
    return result;
}

function getBoolean(value) {
    // 'repair' state: VIS boolean control sets value to 0/1 instead of false/true
    if (typeof value != 'boolean') {
        return value == 1;
    }
    return value;
}

function getStateDefaultFalse(id) {
    if (id == null)
        return false;
    return getBoolean(getStateInternal(id));
}


function getStateDefault0(id) {
    if (id == null)
        return 0;
    return getNumber(getStateInternal(id));
}

function setStateInternal(id, value) {
    let obj = id;
    if (! obj.startsWith(adapter.namespace + '.'))
        obj = adapter.namespace + '.' + id;
    adapter.log.silly('update state ' + obj + ' with value:' + value);
    currentStateValues[obj] = value;
}

function setStateAck(id, value) {
    // State wird intern auch über 'onStateChange' angepasst. Wenn es bereits hier gesetzt wird, klappt die Erkennung
    // von Wertänderungen nicht, weil der interne Wert bereits aktualisiert ist.
    //setStateInternal(id, value);
    adapter.setState(id, {val: value, ack: true});
}

async function setStateAckSync(id, value) {
    // Do synchronous setState
    // State wird intern auch über 'onStateChange' angepasst. Wenn es bereits hier gesetzt wird, klappt die Erkennung
    // von Wertänderungen nicht, weil der interne Wert bereits aktualisiert ist.
    //setStateInternal(id, value);
    const promisedSetState = (id, value) => new Promise(resolve => adapter.setState(id, {val: value, ack: true}, resolve));
    await promisedSetState(id, value);
}

function checkFirmware() {
    if (getWallboxModel() == MODEL_P30) {
        try {
            request.get(firmwareUrl, processFirmwarePage);
        } catch (e) {
            adapter.log.warn('Error requesting firmware url ' + firmwareUrl + 'e: ' + e);
        }
    }
    return;
}

function sendWallboxWarning(message) {
    if (! wallboxWarningSent) {
        adapter.log.warn(message);
        wallboxWarningSent = true;
    }

}

function getWallboxModel() {
    const type = getStateInternal(stateProduct);
    if (typeof type !== 'string') {
        return -1;
    }
    if (type.startsWith('KC-P20')) {
        return MODEL_P20;
    }
    if (type.startsWith('KC-P30') && (type.substr(15, 1) == '-')) {
        return MODEL_P30;
    }
    if (type.startsWith('BMW-10')  && (type.substr(15, 1) == '-')) {
        return MODEL_BMW;
    }
    return 0;
}

function getWallboxType() {
    const type = getStateInternal(stateProduct);
    switch (getWallboxModel()) {
        case -1:
            return 0;
        case MODEL_P20:
            switch (type.substr(13,1)) {
                case '0': return TYPE_E_SERIES;
                case '1':
                    sendWallboxWarning('KeContact P20 b-series will not be supported!');
                    return TYPE_B_SERIES;
                case '2':  // c-series
                case '3':  // c-series + PLC (only P20)
                case 'A':  // c-series + WLAN
                case 'K':  // Dienstwagen-Wallbox / Company Car Wall Box MID / Art.no. 126 389
                    return TYPE_C_SERIES;
                case 'B':  // x-series
                case 'C':  // x-series + GSM
                case 'D':  // x-series + GSM + PLC
                    return TYPE_X_SERIES;
            }
            break;
        case MODEL_P30:
            if (type.endsWith('-DE')) {   // KEBA says there's only one ID: KC-P30-EC220112-000-DE
                sendWallboxWarning('Keba KeContact P30 Deutschland-Edition detected. Regulation may be inaccurate.');
                return TYPE_D_EDITION;
            }
            // fall through
        case MODEL_BMW:
            switch (type.substr(13,1)) {
                case '0':
                    return TYPE_E_SERIES;
                case '1':
                    sendWallboxWarning('KeContact P30 b-series will not be supported!');
                    return TYPE_B_SERIES;
                case '2':
                    return TYPE_C_SERIES;
                case '3':
                    sendWallboxWarning('KeContact P30 a-series will not be supported!');
                    return TYPE_A_SERIES;
                case 'B':  // x-series WLAN
                case 'C':  // x-series WLAN + 3G
                case 'E':  // x-series WLAN + 4G
                case 'G':  // x-series 3G
                case 'H':  // x-series 4G
                case 'U':  // KC-P30-EC2204U2-M0R-CC (Company Car Wall Box MID - GREEN EDITION), KC-P30-EC2204U2-E00-PV (Photovoltaic Wallbox Cable - PV-Edition)
                    return TYPE_X_SERIES;
            }
            break;
        default:
    }
    if (! wallboxUnknownSent) {
        sendSentryMessage( 'unknown wallbox type ' + type);
        wallboxUnknownSent = true;
    }
    return 0;
}

function sendSentryMessage(msg) {
    adapter.log.error(msg);
    if (adapter.supportsFeature && adapter.supportsFeature('PLUGINS')) {
        const sentryInstance = adapter.getPluginInstance('sentry');
        if (sentryInstance) {
            sentryInstance.getSentryObject().captureException(msg);
        }
    }
}

function getFirmwareRegEx() {
    switch (getWallboxModel()) {
        case -1:
            return 0;
        case MODEL_P30 :
            switch (getWallboxType()) {
                case TYPE_C_SERIES :
                case TYPE_D_EDITION :
                    return regexP30cSeries;
                case TYPE_X_SERIES :
                    return null;  // regexP30xSeries; x-Series no longer supported for firmware check
                default:
                    return null;
            }
        case MODEL_P20 :  // as mail of Keba on 06th august 2021 there will be no forther firmware updates
        case MODEL_BMW :
        default:
            return null;
    }
}

function processFirmwarePage(err, stat, body) {
    const prefix = 'Keba firmware check: ';
    if (err) {
        adapter.log.warn(prefix + err);
    } else if (stat.statusCode != 200) {
        adapter.log.warn('Firmware page could not be loaded (' + stat.statusCode + ')');
    } else if (body) {
        const regexPattern = getFirmwareRegEx();
        if (! regexPattern || (regexPattern == null)) {
            return;
        }
        regexPattern.lastIndex = 0;
        const list = regexPattern.exec(body);
        if (list) {
            regexFirmware.lastIndex = 0;
            const block = regexFirmware.exec(list[1]);
            if (block) {
                setStateAck(stateFirmwareAvailable, block[1]);
                const currFirmware = getStateInternal(stateFirmware);
                regexCurrFirmware.lastIndex = 0;
                const currFirmwareList = regexCurrFirmware.exec(currFirmware);
                if (currFirmwareList) {
                    currFirmwareList[1] = 'V'+currFirmwareList[1];
                    if (block[1] == currFirmwareList[1]) {
                        adapter.log.info(prefix + 'latest firmware installed');
                    } else {
                        adapter.log.warn(prefix + 'current firmware ' + currFirmwareList[1] + ', <a href="' + firmwareUrl + '">new firmware ' + block[1] + ' available</a>');
                    }
                } else {
                    adapter.log.error(prefix + 'current firmare unknown: ' + currFirmware);
                }
            } else {
                adapter.log.warn(prefix + 'no firmware found');
            }
        } else {
            // disabled due to chenges on webpage of Keba
            //adapter.log.warn(prefix + 'no section found');
            //adapter.log.debug(body);
        }
    } else {
        adapter.log.warn(prefix + 'empty page, status code ' + stat.statusCode);
    }
    return true;
}

function createHistory() {
    // create Sessions Channel
    adapter.setObject('Sessions',
        {
            type: 'channel',
            common: {
                name: 'Sessions Statistics'
            },
            native: {}
        });
    // create Datapoints for 31 Sessions
    for (let i = 0; i <= 30; i++){
        let session = '';
        if (i < 10) {
            session = '0';
        }

        adapter.setObject('Sessions.Session_' + session + i,
            {
                type: 'channel',
                common: {
                    name: 'Session_' +session + i + ' Statistics'
                },
                native: {}
            });

        adapter.setObject('Sessions.Session_' + session + i + '.json',
            {
                'type': 'state',
                'common': {
                    'name':  'Raw json string from Wallbox',
                    'type':  'string',
                    'role':  'json',
                    'read':  true,
                    'write': false,
                    'desc':  'RAW_Json message',
                },
                'native': {
                    'udpKey': session + i + '_json'
                }
            });

        adapter.setObject('Sessions.Session_' + session + i + '.sessionid',
            {
                'type': 'state',
                'common': {
                    'name':  'SessionID of Charging Session',
                    'type':  'number',
                    'role':  'value',
                    'read':  true,
                    'write': false,
                    'desc':  'unique Session ID',
                },
                'native': {
                    'udpKey': session + i + '_Session ID'
                }
            });

        adapter.setObject('Sessions.Session_' + session + i + '.currentHardware',
            {
                'type': 'state',
                'common': {
                    'name':  'Maximum Current of Hardware',
                    'type':  'number',
                    'role':  'value',
                    'read':  true,
                    'write': false,
                    'desc':  'Maximum Current that can be supported by hardware',
                    'unit':  'mA',
                },
                'native': {
                    'udpKey': session + i + '_Curr HW'
                }
            });

        adapter.setObject('Sessions.Session_' + session + i + '.eStart',
            {
                'type': 'state',
                'common': {
                    'name':  'Energy Counter Value at Start',
                    'type':  'number',
                    'role':  'value',
                    'read':  true,
                    'write': false,
                    'desc':  'Total Energy Consumption at beginning of Charging Session',
                    'unit':  'Wh',
                },
                'native': {
                    'udpKey': session + i + '_E start',
                    'udpMultiplier': 0.1
                }
            });

        adapter.setObject('Sessions.Session_' + session + i + '.ePres',
            {
                'type': 'state',
                'common': {
                    'name':  'Charged Energy in Current Session',
                    'type':  'number',
                    'role':  'value',
                    'read':  true,
                    'write': false,
                    'desc':  'Energy Transfered in Current Charging Session',
                    'unit':  'Wh',
                },
                'native': {
                    'udpKey': session + i + '_E pres',
                    'udpMultiplier': 0.1
                }
            });

        adapter.setObject('Sessions.Session_' + session + i + '.started_s',
            {
                'type': 'state',
                'common': {
                    'name':  'Time or Systemclock at Charging Start in Seconds',
                    'type':  'number',
                    'role':  'value',
                    'read':  true,
                    'write': false,
                    'desc':  'Systemclock since System Startup at Charging Start',
                    'unit':  's',
                },
                'native': {
                    'udpKey': session + i + '_started[s]'
                }
            });

        adapter.setObject('Sessions.Session_' + session + i + '.ended_s',
            {
                'type': 'state',
                'common': {
                    'name':  'Time or Systemclock at Charging End in Seconds',
                    'type':  'number',
                    'role':  'value',
                    'read':  true,
                    'write': false,
                    'desc':  'Systemclock since System Startup at Charging End',
                    'unit':  's',
                },
                'native': {
                    'udpKey': session + i + '_ended[s]'
                }
            });

        adapter.setObject('Sessions.Session_' + session + i + '.started',
            {
                'type': 'state',
                'common': {
                    'name':  'Time at Start of Charging',
                    'type':  'string',
                    'role':  'date',
                    'read':  true,
                    'write': false,
                    'desc':  'Time at Charging Session Start',
                },
                'native': {
                    'udpKey': session + i + '_started'
                }
            });

        adapter.setObject('Sessions.Session_' + session + i + '.ended',
            {
                'type': 'state',
                'common': {
                    'name':  'Time at End of Charging',
                    'type':  'string',
                    'role':  'date',
                    'read':  true,
                    'write': false,
                    'desc':  'Time at Charging Session End',
                },
                'native': {
                    'udpKey': session + i + '_ended'
                }
            });

        adapter.setObject('Sessions.Session_' + session + i + '.reason',
            {
                'type': 'state',
                'common': {
                    'name':  'Reason for End of Session',
                    'type':  'number',
                    'role':  'value',
                    'read':  true,
                    'write': false,
                    'desc':  'Reason for End of Charging Session',
                },
                'native': {
                    'udpKey': session + i + '_reason'
                }
            });

        adapter.setObject('Sessions.Session_' + session + i + '.timeQ',
            {
                'type': 'state',
                'common': {
                    'name':  'Time Sync Quality',
                    'type':  'number',
                    'role':  'value',
                    'read':  true,
                    'write': false,
                    'desc':  'Time Synchronisation Mode',
                },
                'native': {
                    'udpKey': session + i + '_timeQ'
                }
            });

        adapter.setObject('Sessions.Session_' + session + i + '.rfid_tag',
            {
                'type': 'state',
                'common': {
                    'name':  'RFID Tag of Card used to Start/Stop Session',
                    'type':  'string',
                    'role':  'text',
                    'read':  true,
                    'write': false,
                    'desc':  'RFID Token used for Charging Session',
                },
                'native': {
                    'udpKey': session + i + '_RFID tag'
                }
            });

        adapter.setObject('Sessions.Session_' + session + i + '.rfid_class',
            {
                'type': 'state',
                'common': {
                    'name':  'RFID Class of Card used to Start/Stop Session',
                    'type':  'string',
                    'role':  'text',
                    'read':  true,
                    'write': false,
                    'desc':  'RFID Class used for Session',
                },
                'native': {
                    'udpKey': session + i + '_RFID class'
                }
            });

        adapter.setObject('Sessions.Session_' + session + i + '.serial',
            {
                'type': 'state',
                'common': {
                    'name':  'Serialnumber of Device',
                    'type':  'string',
                    'role':  'text',
                    'read':  true,
                    'write': false,
                    'desc':  'Serial Number of Device',
                },
                'native': {
                    'udpKey': session + i + '_Serial'
                }
            });

        adapter.setObject('Sessions.Session_' + session + i + '.sec',
            {
                'type': 'state',
                'common': {
                    'name':  'Current State of Systemclock',
                    'type':  'number',
                    'role':  'value',
                    'read':  true,
                    'write': false,
                    'desc':  'Current State of System Clock since Startup of Device',
                },
                'native': {
                    'udpKey': session + i + '_Sec'
                }
            });

    }
}

if (require.main !== module) {
    // Export startAdapter in compact mode
    module.exports = startAdapter;
} else {
    // otherwise start the instance directly
    startAdapter();
}
