#include "boards_config.h" // board pinouts are in this file

// Flywheel Settings
// If variableFPS is true, the following settings are set on boot and locked. Otherwise, it always uses the first mode
bool variableFPS = true;
int32_t revRPMset[3][4] = { { 40000, 40000, 40000, 40000 }, { 25000, 25000, 25000, 25000 }, { 14000, 14000, 14000, 14000 } }; // adjust this to change fps, groups are firingMode 1, 2, 3, and the 4 elements in each group are individual motor RPM
uint32_t idleTimeSet_ms[3] = { 0, 0, 0 }; // how long to idle the flywheels for after releasing the trigger, in milliseconds
uint32_t firingDelaySet_ms[3] = { 150, 125, 100 }; // delay to allow flywheels to spin up before firing dart
uint32_t firingDelayIdleSet_ms[3] = { 125, 100, 80 }; // delay to allow flywheels to spin up before firing dart when starting from idle state
uint32_t spindownSpeed = 30; // RPM per ms

int32_t motorKv = 3200; // critical for closed loop
int32_t idleRPM[4] = { 0, 0, 500, 500 }; // rpm for flywheel idling, set this as low as possible where the wheels still spin reliably
dshot_mode_t dshotMode = DSHOT300; // Options are DSHOT150, DSHOT300, DSHOT600, or DSHOT_OFF. DSHOT300 is recommended, DSHOT150 does not work with either AM32 ESCs or closed loop control, and DSHOT600 seems less reliable. DSHOT_OFF falls back to servo PWM. PWM is not working, probably a ESP32 timer resource conflict with the pusher PWM circuit
dshot_min_delay_t targetLoopTime_us = DSHOT_MIN_DELAY_300; // PID Loop time, must correspond to dshotmode

// Closed Loop Settings
flywheelControlType_t flywheelControl = TBH_CONTROL; // OPEN_LOOP_CONTROL, TWO_LEVEL_CONTROL, PID_CONTROL, or TBH_CONTROL
const bool motors[4] = {false, false, true, false}; // which motors are hooked up
bool timeOverrideWhenIdling = true; // while idling, fire the pusher after firingDelay_ms even before the flywheels are up to speed
int32_t fullThrottleRpmTolerance = 5000; // if rpm is more than this amount below target rpm, send full throttle. too high and rpm will undershoot, too low and it will overshoot
int32_t firingRPMTolerance = 10000; // fire pusher when all flywheels are within this amount of target rpm. higher values will mean less pusher delay but potentially fire too early
int32_t minFiringRPM = 10000; // overrides firingRPMTolerance for low rpm settings
int32_t minFiringDelaySet_ms[3] = {0, 0, 0}; // when not idling, don't fire the pusher before this amount of time, even if wheels are up to speed. makes the delay more consistent
int32_t minFiringDelayIdleSet_ms[3] = {0, 0, 0}; // same but when idling

// Select Fire Settings
uint32_t burstLengthSet[3] = { 100, 5, 1 };
burstFireType_t burstModeSet[3] = { AUTO, AUTO, BURST };
// burstMode AUTO = stops firing when trigger is released
// burstMode BURST = always completes the burst
// burstMode BINARY = fires one burst when you pull the trigger and another when you release the trigger
// for full auto, set burstLength high (50+) and burstMode to AUTO
// for semi auto, set burstLength to 1 and burstMode to BURST
// for burst fire, set burstLength and burstMode to BURST
// i find a very useful mode is full auto with a 5 dart limit (burstMode AUTO, burstLength 5)

uint32_t binaryTriggerTimeout_ms = 2000; // if you hold the trigger for more than this amount of time, releasing the trigger will not fire a burst


selectFireType_t selectFireType = NO_SELECT_FIRE; // pick NO_SELECT_FIRE, SWITCH_SELECT_FIRE, or BUTTON_SELECT_FIRE
uint8_t defaultFiringMode = 1; // only for SWITCH_SELECT_FIRE, what mode to select if no pins are connected

// Dettlaff Settings
uint32_t lowVoltageCutoff_mv = 2500 * 4; // default is 2.5V per cell * 4 cells because the ESP32 voltage measurement is not very accurate
// to protect your batteries, i reccomend doing the calibration below and then setting the cutoff to 3.2V to 3.4V per cell
float voltageCalibrationFactor = 1.0; // measure the battery voltage with a multimeter and divide that by the "Battery voltage before calibration" printed in the Serial Monitor, then put the result here


boards_t board = pico_zero; // select the one that matches your board revision
// Options
// rune_0_2,
// possibly standalone board TODO

// Input Pins, set to 0 if not using
uint8_t triggerSwitchPin = board.IO1; // main trigger pin
uint8_t revSwitchPin = board.IO2; // optional rev trigger
uint8_t cycleSwitchPin = 0; // pusher motor home switch
uint8_t select0Pin = 0; // optional for select fire
uint8_t select1Pin = 0; // optional for select fire
uint8_t select2Pin = 0; // optional for select fire


// Pusher Settings
pusherType_t pusherType = PUSHER_MOTOR_CLOSEDLOOP; // either PUSHER_MOTOR_CLOSEDLOOP or PUSHER_SOLENOID_OPENLOOP
uint32_t pusherVoltage_mv = 13000; // if battery voltage is above this voltage, then use PWM to reduce the voltage that the pusher sees
bool pusherReverseDirection = false; // make motor spin backwards


// Solenoid Settings
uint16_t solenoidExtendTimeHigh_ms = 25; // set this to the high voltage min push time
uint32_t solenoidExtendTimeHighVoltage_mv = 16800; // set this to the voltage at which the solenoid still extends fully at the solenoidExtendTimeHigh_ms time (from log)
uint16_t solenoidExtendTimeLow_ms = 40;
uint32_t solenoidExtendTimeLowVoltage_mv = 11800; // set this to the voltage at which the solenoid still extends fully at the solenoidExtendTimeLow_ms time (from log)
uint16_t solenoidRetractTime_ms = 35;

// Advanced Settings
uint16_t pusherStallTime_ms = 750; // for PUSHER_MOTOR_CLOSEDLOOP, how long do you run the motor without seeing an update on the cycle control switch before you decide the motor is stalled?
bool revSwitchNormallyClosed = false; // invert switch signal?
bool triggerSwitchNormallyClosed = false;
bool cycleSwitchNormallyClosed = false;
uint16_t debounceTime_ms = 100; // decrease if you're unable to make fast double taps in semi auto, increase if you're getting accidental double taps in semi auto
uint16_t pusherDebounceTime_ms = 25;
const int voltageAveragingWindow = 1;
uint32_t pusherCurrentSmoothingFactor = 90;
uint8_t telemetryInterval_ms = 5;
float maxDutyCycle_pct = 98;
uint8_t deadtime = 10;
uint16_t pwmFreq_hz = 20000;
uint16_t servoFreq_hz = 200;

// PID Settings
float KP = 1.2;
// float KI = 0.1;
float KD = 0;

// TBH Settings
// for TBH PIDIntegral is used for TBH variable, and Gain is KI

float KI = 0.03;

// Debug settings
bool printTelemetry = true; // output printing
#define USE_RPM_LOGGING //RPM Logging
#ifdef USE_RPM_LOGGING
const uint32_t rpmLogLength = 2000;
#endif


#define MOTOR_POLES 14
