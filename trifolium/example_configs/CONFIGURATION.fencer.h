#include "boards_config.h" // board pinouts are in this file

//config to check config and code versions match
#define CONFIG_VERSION_MAJOR 1
#define CONFIG_VERSION_MINOR 3
#define CONFIG_VERSION_PATCH 0


// Flywheel Settings
// If variableFPS is true, the following settings are set on boot and locked. Otherwise, it always uses the first mode
bool variableFPS = true;
int32_t revRPMset[3][4] = { { 0, 10000, 0, 10000 }, { 0, 28000, 0, 28000 }, { 0, 27000, 0, 27000 } }; // adjust this to change fps, groups are firingMode 1, 2, 3, and the 4 elements in each group are individual motor RPM. Typically we do assume esc 2/4 and 1/3 are paired
uint32_t dwellTimeSet_ms[3] = { 0, 0,0 }; // how long to keep the flywheels at full rpm for after releasing the trigger, in milliseconds
uint32_t idleTimeSet_ms[3] = { 5000, 5000, 5000 }; // how long to keep the flywheels spinning after dwell time, in milliseconds
//uint32_t firingDelaySet_ms[3] = { 150, 125, 100 }; // delay to allow flywheels to spin up before firing dart
//uint32_t firingDelayIdleSet_ms[3] = { 125, 100, 80 }; // delay to allow flywheels to spin up before firing dart when starting from idle state
uint32_t spindownSpeed = 100; // RPM per ms

int32_t motorKv = 3200; // critical for closed loop
int32_t idleRPM[4] = { 1000, 1000, 1000, 1000 }; // rpm for flywheel idling, set this as low as possible where the wheels still spin reliably
dshot_mode_t dshotMode = DSHOT300; // Options are DSHOT150, DSHOT300, DSHOT600, or DSHOT_OFF. DSHOT300 is recommended, DSHOT150 does not work with either AM32 ESCs or closed loop control, and DSHOT600 seems less reliable. DSHOT_OFF falls back to servo PWM. PWM is not working, probably a ESP32 timer resource conflict with the pusher PWM circuit
dshot_min_delay_t targetLoopTime_us = DSHOT_MIN_DELAY_300; // PID Loop time, must correspond to dshotmode

// Closed Loop Settings
flywheelControlType_t flywheelControl = PID_CONTROL; // PID_CONTROL, or TBH_CONTROL
const bool motors[4] = {false, true, false, true}; // which motors are hooked up
//bool timeOverrideWhenIdling = true; // while idling, fire the pusher after firingDelay_ms even before the flywheels are up to speed
int32_t fullThrottleRpmTolerance = 5000; // if rpm is more than this amount below target rpm, send full throttle. too high and rpm will undershoot, too low and it will overshoot NOT USED CURRENTLY
int32_t firingRPMTolerance = 500; // fire pusher when all flywheels are within this amount of target rpm. higher values will mean less pusher delay but potentially fire too early
int32_t minFiringRPM = 10000; // overrides firingRPMTolerance for low rpm settings 
//int32_t minFiringDelaySet_ms[3] = {0, 0, 0}; // when not idling, don't fire the pusher before this amount of time, even if wheels are up to speed. makes the delay more consistent
//int32_t minFiringDelayIdleSet_ms[3] = {0, 0, 0}; // same but when idling

// Select Fire Settings
uint32_t burstLengthSet[3] = { 100, 1, 1 };
burstFireType_t burstModeSet[3] = { AUTO, BINARY, BURST };
const char * fireModeStrings[3] = { "AUTO", "BINARY", "SEMI" };
// burstMode AUTO = stops firing when trigger is released
// burstMode BURST = always completes the burst
// burstMode BINARY = fires one burst when you pull the trigger and another when you release the trigger
// for full auto, set burstLength high (50+) and burstMode to AUTO
// for semi auto, set burstLength to 1 and burstMode to BURST
// for burst fire, set burstLength and burstMode to BURST
// i find a very useful mode is full auto with a 5 dart limit (burstMode AUTO, burstLength 5)
// it is your responsibility to set the firemode string to the appropriate option.

uint32_t binaryTriggerTimeout_ms = 1000; // if you hold the trigger for more than this amount of time, releasing the trigger will not fire a burst


selectFireType_t selectFireType = SWITCH_SELECT_FIRE; // pick NO_SELECT_FIRE, SWITCH_SELECT_FIRE, 
uint8_t defaultFiringMode = 1; // only for SWITCH_SELECT_FIRE, what mode to select if no pins are connected

// Board Settings
uint32_t lowVoltageCutoff_mv = 2500 * 4; // default is 2.5V per cell * 4 cells because the ESP32 voltage measurement is not very accurate
// to protect your batteries, i reccomend doing the calibration below and then setting the cutoff to 3.2V to 3.4V per cell
float voltageCalibrationFactor = 1.0; // measure the battery voltage with a multimeter and divide that by the "Battery voltage before calibration" printed in the Serial Monitor, then put the result here


boards_t board = trifolium_v1_1_esc_driver; // select the one that matches your board revision
// Options
// rune_0_2,
// trifolium_v1_2_esc_driver
// trifolium_v1_2_fet_driver
// trifolium_v1_1_esc_driver
// trifolium_v1_1_fet_driver
// trifolium_v1_0_esc_driver
// trifolium_v1_0_fet_driver
// pico_zero
// pico_zero_diana
const char * blasterName = "Fencer";//set to blaster name
bool hasDisplay = true; // set to true if you have an I2C OLED display connected
bool rotateDisplay = true; // set to true if your display is upside down
bool useRpmBaseShotCounter = true; // if true, shot counter increases based on detected rpm drop, otherwise increases based on pusher cycles
uint16_t goodRpmShotReads = 5;  // number of good rpm reads below threshold to count as a shot
uint16_t rpmDropThreshold = 200; // rpm drop to count as a shot

// Input Pins, set to PIN_NOT_USED if not using
uint8_t triggerSwitchPin = board.IO1; // main trigger pin
uint8_t revSwitchPin = board.IO2; // optional rev trigger
uint8_t cycleSwitchPin = PIN_NOT_USED; // pusher motor home switch
uint8_t select0Pin = board.IO3; // optional for select fire
uint8_t select1Pin = PIN_NOT_USED; // optional for select fire
uint8_t select2Pin = board.IO4; // optional for select fire


// Pusher Settings
pusherType_t pusherType = PUSHER_SOLENOID_OPENLOOP; // PUSHER_SOLENOID_OPENLOOP
//uint32_t pusherVoltage_mv = 13000; // if battery voltage is above this voltage, then use PWM to reduce the voltage that the pusher sees
bool pusherReverseDirection = false; // make motor spin backwards NOT USED


// Solenoid Settings
uint16_t solenoidExtendTimeHigh_ms = 25; // set this to the high voltage min push time
uint32_t solenoidExtendTimeHighVoltage_mv = 16800; // set this to the voltage at which the solenoid still extends fully at the solenoidExtendTimeHigh_ms time (from log)
uint16_t solenoidExtendTimeLow_ms = 25;
uint32_t solenoidExtendTimeLowVoltage_mv = 11800; // set this to the voltage at which the solenoid still extends fully at the solenoidExtendTimeLow_ms time (from log)
uint16_t solenoidRetractTime_ms = 35;

// Advanced Settings
//uint16_t pusherStallTime_ms = 750; // for PUSHER_MOTOR_CLOSEDLOOP, how long do you run the motor without seeing an update on the cycle control switch before you decide the motor is stalled?
bool revSwitchNormallyClosed = false; // invert switch signal?
bool triggerSwitchNormallyClosed = false;
bool cycleSwitchNormallyClosed = false;
uint16_t debounceTime_ms = 100; // decrease if you're unable to make fast double taps in semi auto, increase if you're getting accidental double taps in semi auto
uint16_t pusherDebounceTime_ms = 25; // NOT USED
const int voltageAveragingWindow = 5;
uint32_t pusherCurrentSmoothingFactor = 90;
//uint8_t telemetryInterval_ms = 5;
//float maxDutyCycle_pct = 98;
//uint8_t deadtime = 10;
//uint16_t pwmFreq_hz = 20000;
//uint16_t servoFreq_hz = 200;

// PID Settings
const uint8_t EMAFilter = 2; // exponential moving average filter constant for flywheel RPM readings, higher values mean more smoothing but more lag.
const uint8_t iThreshold = 50; //abs error threshold to activate integration. If this is too low, integration might not activate. If this is too high, integration might activate too soon and cause overshoot.  
float KP = .1;
float KI = 2;
float KD = 0;

// TBH Settings
// for TBH PIDIntegral is used for TBH variable, and Gain is KI

//float KI = 0.01;
const uint16_t throttleCap = 300;

// Debug settings
// For running the blaster without telemetry, set printTelemetry to false and comment out #define USE_RPM_LOGGING
bool printTelemetry = false; // output printing
//#define USE_RPM_LOGGING //RPM Logging
#ifdef USE_RPM_LOGGING
const uint32_t rpmLogLength = 2000;
#endif


#define MOTOR_POLES 14
s