#include <Arduino.h>
#include <PIO_DShot.h>
#include "../lib/Bounce2/src/Bounce2.h"
#include "fetDriver.h"
#include "drvDriver.h"
#include "escDriver.h"
#include "elapsedMillis.h"
#include "pico/stdlib.h"
#include "CONFIGURATION.h"
#include "esc_passthrough.h"
#include "global.h"

#include <SPI.h>
//#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include "bitmaps.h"

#if CONFIG_VERSION_MAJOR != MAJOR_VERSION || CONFIG_VERSION_MINOR != MINOR_VERSION || CONFIG_VERSION_PATCH != PATCH_VERSION
#error "Your configuration file version does not match code version. Update your configuration file with the missing settings!"
#endif

static_assert(EMAFilter > 0, "EMAFilter should be greater than zero");

#define SCREEN_WIDTH 128 // OLED display width, in pixels
#define SCREEN_HEIGHT 64 // OLED display height, in pixels
#define SCREEN_ADDRESS 0x3C ///< See datasheet for Address; 0x3C 

TwoWire myI2C(board.I2C_HW_BLK, board.I2C_SCL, board.I2C_SDA); 
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &myI2C, -1);
//use for communication between cores for display
String displayString = "";
int cursorX = 0;
int cursorY = 0;
bool clearDisplay = false;
bool doDisplayString = false;
//show bootup screen
bool doBootup = false;
//show runtime info
bool showRuntimeInfo = false;
bool updateRuntimeNow = false;
//do menu
bool doMenu = false;
uint32_t runtimeShotCounter = 0;
uint32_t displayShotCounter = 0;

//rebooting stuff
BootReason bootReason;
BootReason __uninitialized_ram(rebootReason);
u64 __uninitialized_ram(powerOnResetMagicNumber);


uint32_t lastRevTime_ms = 0; // for calculating idling

uint32_t loopStartTimer_us = micros();
int32_t loopTime_us = targetLoopTime_us;
uint32_t lastMainLoopTime = millis();
uint32_t time_ms = millis();
// uint32_t lastRevTime_ms = 0; // for calculating idling
uint32_t pusherTimer_ms = 0;
uint32_t revStartTime_us = 0;
uint32_t triggerTime_ms = 0;

uint32_t revRPM[4];                   // stores value from revRPMSet on boot for current firing mode
uint32_t dwellTime_ms;                 // stores value from dwellTimeSet_ms on boot for current firing mode
uint32_t idleTime_ms;                 // stores value from idleTimeSet_ms on boot for current firing mode
uint32_t targetRPM[4] = {0, 0, 0, 0}; // stores current target rpm
uint32_t firingRPM[4];
// uint32_t throttleValue[4] = { 0, 0, 0, 0 }; // scale is 0 - 2000
uint32_t currentSpindownSpeed = 0;
uint16_t burstLength;      // stores value from burstLengthSet for current firing mode
burstFireType_t burstMode; // stores value from burstModeSet for current firing mode
int8_t firingMode = 0;     // current firing mode
int8_t fpsMode = 0;        // copy of firingMode locked at boot
bool fromIdle;
int32_t dshotValue = 0;
int16_t shotsToFire = 0;
flywheelState_t flywheelState = STATE_IDLE;
bool firing = false;
bool reverseBraking = false;
bool pusherDwelling = false;
bool isBatteryAdcDefined = false;
uint32_t batteryADC_mv = 0;
int32_t batteryVoltage_mv = 14800;
int32_t voltageBuffer[voltageAveragingWindow] = {0};
int voltageBufferIndex = 0;
int32_t pusherShunt_mv = 0;
int32_t pusherCurrent_ma = 0;
int32_t pusherCurrentSmoothed_ma = 0;
const int32_t maxThrottle = 1999;
uint32_t motorRPM[4] = {0, 0, 0, 0};
uint32_t motorRPMRaw[4] = {0, 0, 0, 0};
uint32_t motorRPMFilter[4] = {0, 0, 0, 0};
constexpr static uint32_t half = uint32_t{1} << (EMAFilter - 1);
uint32_t fullThrottleRpmThreshold[4] = {0, 0, 0, 0};
Driver *pusher;
uint16_t solenoidExtendTime_ms = 0;
float solenoidVoltageTimeSlope = 0; // relationship between voltage and solenoid extend time calculated at setup
int16_t solenoidVoltageTimeIntercept = 0;
bool wifiState = false;
// String telemBuffer = "";
int8_t telemMotorNum = -1; // 0-3

int32_t tempRPM;
bool currentlyLogging = false;
bool enableFwControl = true;

// closed loop variables
int32_t PIDError[4];
int32_t PIDErrorPrior[4] = {1,1,1,1};
int32_t closedLoopRPM[4];
int32_t PIDOutput[4];
int32_t PIDIntegral[4] = {0, 0, 0, 0};
int32_t iTerm[4] = {0, 0, 0, 0};
int32_t dTerm[4] = {0, 0, 0, 0};


Bounce2::Button revSwitch = Bounce2::Button();
Bounce2::Button triggerSwitch = Bounce2::Button();
Bounce2::Button cycleSwitch = Bounce2::Button();
Bounce2::Button button = Bounce2::Button();
Bounce2::Button select0 = Bounce2::Button();
Bounce2::Button select1 = Bounce2::Button();
Bounce2::Button select2 = Bounce2::Button();

BidirDShotX1 *esc[4] = {nullptr, nullptr, nullptr, nullptr}; // array of pointers to BidirDShotX1 objects for each motor

// rpm logging
#ifdef USE_RPM_LOGGING
uint32_t targetRpmCache[rpmLogLength][4] = {0};
uint32_t rpmCache[rpmLogLength][4] = {0};
int16_t throttleCache[rpmLogLength][4] = {0}; // float gets converted to an integer [0, 1999]
uint32_t valueCache[rpmLogLength][4] = {0}; // float gets converted to an integer [0, 1999]
uint16_t cacheIndex = rpmLogLength + 1;
#endif

void updateFiringMode();
bool fwControlLoop();
void mainFiringLogic();
void resetFWControl();

//display functions
// I think this will just be used for initial messages? 
void displayText(String str, int curX = 0, int curY = 0, bool clearScreen = false);


template <typename T>
void println(T value)
{
    if (printTelemetry)
        Serial.println(value);
}

template <typename T>
void print(T value)
{
    if (printTelemetry)
        Serial.print(value);
}

bool pinDefined(uint8_t pin)
{
    return pin != PIN_NOT_USED;
}

void logData(){
    // if we have rpm logging enabled, add the most recent value to the cache
    #ifdef USE_RPM_LOGGING
    for (int i = 0; i < 4; i++) {
            if (motors[i]) {
                if (cacheIndex < rpmLogLength)
                {
                    rpmCache[cacheIndex][i] = motorRPM[i];
                    targetRpmCache[cacheIndex][i] = targetRPM[i]; // mostly for reference
                    throttleCache[cacheIndex][i] = (int16_t)((PIDOutput[i]));
                    valueCache[cacheIndex][i] = PIDIntegral[i];
                }
            }
        }
    #endif
}


void setup()
{
    if (powerOnResetMagicNumber == 0xdeadbeefdeadbeef)
		bootReason = rebootReason;
	else
	    bootReason = BootReason::POR;
	powerOnResetMagicNumber = 0xdeadbeefdeadbeef;
	rebootReason = BootReason::WATCHDOG;
    Serial.begin(115200);
    Serial.ignoreFlowControl(true);
    
    // need to do some checking for valid motor/esc driver pins here
    for (int i = 0; i < 4; i++)
    {
        if (motors[i])
        {
            if (i == 0)
                {
                if(board.pusherDriverType == ESC_DRIVER && board.drvEN == board.esc1 ){
                    while(1){
                        println("Motor conflict with solenoid drive pin");
                        println("Either change pusher type, or disable motor");
                        delay(1000);
                    }
                }
            }
            else if (i == 1)
            {
                if(board.pusherDriverType == ESC_DRIVER && board.drvEN == board.esc2 ){
                    while(1){
                        println("Motor conflict with solenoid drive pin");
                        println("Either change pusher type, or disable motor");
                        delay(1000);
                    }
                }
            }
            else if (i == 2)
            {
                if(board.pusherDriverType == ESC_DRIVER && board.drvEN == board.esc3 ){
                    while(1){
                        println("Motor conflict with solenoid drive pin");
                        println("Either change pusher type, or disable motor");
                        delay(1000);
                    }
                }
            }
            else if (i == 3)
            {
                if(board.pusherDriverType == ESC_DRIVER && board.drvEN == board.esc4 ){
                    while(1){
                        println("Motor conflict with solenoid drive pin");
                        println("Either change pusher type, or disable motor");
                        delay(1000);
                    }
                }
            }
        }
    }
    
    // esc passthrough requires a trigger pin
    if (bootReason == BootReason::TO_ESC_PASSTHROUGH && pinDefined(triggerSwitchPin)) {
        // setup the trigger pin to exit passthrough

        triggerSwitch.attach(triggerSwitchPin, INPUT_PULLUP);
        triggerSwitch.interval(debounceTime_ms);
        triggerSwitch.setPressedState(triggerSwitchNormallyClosed);

        // only do esc passthrough for the motors that are defined and esc driver pin if defined
        u8 numPassthrough = 0;
        for (int i = 0; i < 4; i++)
        {
            if (motors[i])
            {
                numPassthrough++;
            }
        }
        if (board.pusherDriverType == ESC_DRIVER)
            {
            numPassthrough++; 
        }
        u8 pins[numPassthrough] = {0};
        u8 currentPin = 0;
        if (board.pusherDriverType == ESC_DRIVER)
        {
            pins[currentPin] = board.drvEN; 
            currentPin++;
        }
        for (int i = 0; i < 4; i++)
        {
            if (motors[i])
            {
                u8 escPin = 0;
                if (i == 0){
                    escPin = board.esc1;
                } else if (i == 1){
                    escPin = board.esc2;
                } else if (i == 2){
                    escPin = board.esc3;
                } else if (i == 3){
                    escPin = board.esc4;
                }
                pins[currentPin] = escPin;
                currentPin++;
            }
        }

        displayText("ESC Passthrough, hold trigger to exit", 0, 0, true);

        beginPassthrough(pins, numPassthrough);
        unsigned long currentTime = millis(); 
        while (processPassthrough()) {
            triggerSwitch.update();
            if (!triggerSwitch.isPressed())
            {
                currentTime = millis();
            }
            if (millis() - currentTime > 3000) {
                //exit passthrough after 3 secs of trigger
                break;
            }
        }
        bootReason == BootReason::FROM_ESC_PASSTHROUGH;
        delay(100);
        rp2040.reboot();
    }
    // display bootup screen if available
    doBootup = true;
    println("Booting");
    //delay to allow gpio to stabilize
    delay(1000);

    if (pinDefined(board.batteryADC)){
        pinMode(board.batteryADC, INPUT);
        batteryADC_mv = (analogRead(board.batteryADC) * 3300UL) / 1023;
        batteryVoltage_mv = voltageCalibrationFactor * batteryADC_mv * 11;
        print("Battery voltage (before calibration): ");
        println(batteryADC_mv * 11);
        if (voltageCalibrationFactor != 1.0) {
            print("Battery voltage (after calibration): ");
            println(voltageCalibrationFactor * batteryADC_mv * 11);
        }
        isBatteryAdcDefined = true;
    } else {
        isBatteryAdcDefined = false;
        //TODO don't assume 4s.
        batteryVoltage_mv = 14800; // assume fully charged if no adc defined
    }
    

    if (pinDefined(revSwitchPin))
    {
        revSwitch.attach(revSwitchPin, INPUT_PULLUP);
        revSwitch.interval(debounceTime_ms);
        revSwitch.setPressedState(revSwitchNormallyClosed);
    }
    if (pinDefined(triggerSwitchPin))
    {
        triggerSwitch.attach(triggerSwitchPin, INPUT_PULLUP);
        triggerSwitch.interval(debounceTime_ms);
        triggerSwitch.setPressedState(triggerSwitchNormallyClosed);
    }
    if (pinDefined(cycleSwitchPin))
    {
        cycleSwitch.attach(cycleSwitchPin, INPUT_PULLUP);
        cycleSwitch.interval(pusherDebounceTime_ms);
        cycleSwitch.setPressedState(cycleSwitchNormallyClosed);
    }
    if (selectFireType != NO_SELECT_FIRE)
    {
        if (pinDefined(select0Pin))
        {
            select0.attach(select0Pin, INPUT_PULLUP);
            select0.interval(debounceTime_ms);
            select0.setPressedState(false);
        }
        if (pinDefined(select1Pin))
        {
            select1.attach(select1Pin, INPUT_PULLUP);
            select1.interval(debounceTime_ms);
            select1.setPressedState(false);
        }
        if (pinDefined(select2Pin))
        {
            select2.attach(select2Pin, INPUT_PULLUP);
            select2.interval(debounceTime_ms);
            select2.setPressedState(false);
        }
    }

    if (pinDefined(board.ESC_ENABLE)){
        pinMode(board.ESC_ENABLE, OUTPUT);
       /* if (pinDefined(triggerSwitchPin)){
            triggerSwitch.update();
            delay(20);
            println("Waiting for trigger press to enable ESCs...");
            while (!triggerSwitch.isPressed()) {
                println("help");
                // block for trigger to be pressed before arming esc's
                /*displayOverride = true;
                display.clearDisplay();
                display.setCursor(0,0);
                display.setTextSize(2);
                display.println("PRESS TRIGGER TO BOOT");*/
               // triggerSwitch.update();
               // delay(10);
            //}*/
        //}
        digitalWrite(board.ESC_ENABLE, LOW); 
    }
  

    //if trigger is pulled on boot, enter esc passthrough mode
    triggerSwitch.update();
    if (triggerSwitch.isPressed()) {
        rebootReason = BootReason::TO_ESC_PASSTHROUGH;
        delay(100);
        rp2040.reboot();
    }

    switch (board.pusherDriverType)
    {
    case DRV_DRIVER:
        pusher = new Drv(board.drvPH, board.drvEN, board.drvNSLEEP, board.drvMOSI, board.drvMISO, board.drvNSCS, board.drvSCLK);
        break;
    case FET_DRIVER:
        pusher = new Fet(board.drvEN);
        break;
    case ESC_DRIVER:
        pusher = new EscDriver(board.drvEN);
        break;
    default:
        break;
    }


    switch (pusherType) {
    case PUSHER_MOTOR_CLOSEDLOOP:
        break;
    case PUSHER_SOLENOID_OPENLOOP:
        if (solenoidExtendTimeLow_ms == solenoidExtendTimeHigh_ms || solenoidExtendTimeLowVoltage_mv > solenoidExtendTimeHighVoltage_mv) { // if times are equal, don't do this calc
            solenoidVoltageTimeIntercept = solenoidExtendTimeHigh_ms;
        } else {
            solenoidVoltageTimeSlope = (solenoidExtendTimeHigh_ms - solenoidExtendTimeLow_ms) / ((float)(solenoidExtendTimeHighVoltage_mv - solenoidExtendTimeLowVoltage_mv));
            solenoidVoltageTimeIntercept = solenoidExtendTimeHigh_ms - (solenoidVoltageTimeSlope * solenoidExtendTimeHighVoltage_mv) + 1;
            print("solenoidVoltageTimeSlope: ");
            println(solenoidVoltageTimeSlope);
            print("solenoidVoltageTimeIntercept: ");
            println(solenoidVoltageTimeIntercept);
        }

        break;
    default:
        break;
    }

    // change FPS using select fire switch position at boot time
    if (variableFPS)
    {
        updateFiringMode();
    }

    fpsMode = firingMode;
    print("fpsMode: ");
    println(fpsMode);
    for (int i = 0; i < 4; i++)
    {
        if (motors[i])
        {
            revRPM[i] = revRPMset[fpsMode][i];
            firingRPM[i] = max(revRPM[i] - firingRPMTolerance, minFiringRPM);
            fullThrottleRpmThreshold[i] = revRPM[i] - fullThrottleRpmTolerance;
            if (i == 0)
            {
                esc[i] = new BidirDShotX1(board.esc1, dshotMode);
            }
            else if (i == 1)
            {
                esc[i] = new BidirDShotX1(board.esc2, dshotMode);
            }
            else if (i == 2)
            {
                esc[i] = new BidirDShotX1(board.esc3, dshotMode);
            }
            else if (i == 3)
            {
                esc[i] = new BidirDShotX1(board.esc4, dshotMode);
            }
        }
    }
    dwellTime_ms = dwellTimeSet_ms[fpsMode];
    idleTime_ms = idleTimeSet_ms[fpsMode];
    // make sure to send neutral throttle to arm esc's
    for (int j = 0; j < 15000; j++) {
        //if pusher is esc driver, do the startup loop for the esc driver too
        if (board.pusherDriverType == ESC_DRIVER){
            pusher->update();
        }
        //do neutral throttle for all motors
        for (int i = 0; i < 4; i++)
        {
            if (motors[i])
            {
                esc[i]->sendThrottle(0);
            }
        }
        delayMicroseconds(100);
    }

    showRuntimeInfo = true;
}

void loop()
{
    loopStartTimer_us = micros();
    time_ms = millis();
    fwControlLoop();

    if (lastMainLoopTime != time_ms)
    { // run main loop roughly every 1 ms
        mainFiringLogic();
        lastMainLoopTime = time_ms;
    }

    
}

void mainFiringLogic()
{
    if (pinDefined(revSwitchPin))
    {
        revSwitch.update();
    }
    if (pinDefined(triggerSwitchPin))
    {
        triggerSwitch.update();
    }
    updateFiringMode();
    // changes burst options
    burstLength = burstLengthSet[firingMode];
    burstMode = burstModeSet[firingMode];


    if (triggerSwitch.pressed() || (burstMode == BINARY && triggerSwitch.released() && time_ms < triggerTime_ms + binaryTriggerTimeout_ms))
    { // pressed and released are transitions, isPressed is for state
        print(time_ms);
        if (triggerSwitch.pressed())
        {
            print(" trigger pressed, burstMode ");
        }
        else if (burstMode == BINARY && triggerSwitch.released() && time_ms < triggerTime_ms + binaryTriggerTimeout_ms)
        {
            print(" binary trigger released, burstMode ");
        }
        triggerTime_ms = time_ms;
        print(burstMode);
        print(" shotsToFire before ");
        print(shotsToFire);
        if (burstMode == AUTO)
        {
            shotsToFire = burstLength;
        }
        else
        {
            if (shotsToFire < burstLength || shotsToFire == 1)
            {
                shotsToFire += burstLength;
            }
        }
        print(" after ");
        println(shotsToFire);
    }
    else if (triggerSwitch.released())
    {
        if (burstMode == AUTO && shotsToFire > 1)
        {
            shotsToFire = 1;
        }
    }
    if (isBatteryAdcDefined){
        batteryADC_mv = (analogRead(board.batteryADC) * 3300UL) / 1023;
        if (voltageAveragingWindow == 1) {
            batteryVoltage_mv = voltageCalibrationFactor * batteryADC_mv * 11;
        } else {
            voltageBuffer[voltageBufferIndex] = voltageCalibrationFactor * batteryADC_mv * 11;
            voltageBufferIndex = (voltageBufferIndex + 1) % voltageAveragingWindow;
            batteryVoltage_mv = 0;
            for (int i = 0; i < voltageAveragingWindow; i++) {
                batteryVoltage_mv += voltageBuffer[i];
            }
            batteryVoltage_mv /= voltageAveragingWindow; // apply exponential moving average to smooth out noise. Time constant ≈ 1.44 ms
        }
    }
}

bool fwControlLoop()
{
    switch (flywheelState)
    {

    case STATE_IDLE:
        if (isBatteryAdcDefined && batteryVoltage_mv < lowVoltageCutoff_mv && time_ms > 2000)
        {   
            digitalWrite(board.ESC_ENABLE, LOW); // cut power to ESCs and pusher
            print("Battery low, shutting down! ");
            print(batteryVoltage_mv);
            println("mv");
        }

        if (shotsToFire > 0 || revSwitch.isPressed())
        {
            enableFwControl = true;
            revStartTime_us = loopStartTimer_us;
            memcpy(targetRPM, revRPM, sizeof(targetRPM)); // Copy revRPM to targetRPM
            lastRevTime_ms = time_ms;
            flywheelState = STATE_ACCELERATING;
            currentSpindownSpeed = 0; // reset spindownSpeed
            resetFWControl();
            if (flywheelControl == TBH_CONTROL) {
                for (int i = 0; i < 4; i++) {
                    if (motors[i]) {
                        // for optimal rev let's set throttle to max until first crossing
                        PIDOutput[i] = maxThrottle;
                        // premptly setup TBH variable to reduce overshoot
                        PIDIntegral[i] = (2 * map(((targetRPM[i] * 1000) / motorKv), 0, batteryVoltage_mv, 0, maxThrottle)) - PIDOutput[i];
                    }
                }
            }
            #ifdef USE_RPM_LOGGING
            cacheIndex = 0; // reset cache index to start logging
            #endif
        }
        else if (time_ms < lastRevTime_ms + dwellTime_ms && lastRevTime_ms > 0)
        { // dwell flywheels
        }
        else if (time_ms < lastRevTime_ms + dwellTime_ms + idleTime_ms && lastRevTime_ms > 0)
        { // idle flywheels
            enableFwControl = false;
            if (currentSpindownSpeed < spindownSpeed)
            {
                currentSpindownSpeed += 1;
            }
            for (int i = 0; i < 4; i++)
            {
                if (motors[i])
                {
                    int32_t rpmDrop = (currentSpindownSpeed * loopTime_us + 999) / 1000; // rounded up

                    // Prevent targetRPM from going below idle
                    targetRPM[i] = (targetRPM[i] > rpmDrop + idleRPM[i]) ? (targetRPM[i] - rpmDrop) : idleRPM[i];

                }
            }
        }
        else
        { // stop flywheels
            enableFwControl = false;  
            if (currentSpindownSpeed < spindownSpeed)
            {
                currentSpindownSpeed += 1;
            }
            for (int i = 0; i < 4; i++)
            {
                if (motors[i] && targetRPM[i] != 0)
                {
                    int32_t rpmDrop = (currentSpindownSpeed * loopTime_us + 999) / 1000; // rounded up

                    // Prevent targetRPM from going below zero
                    targetRPM[i] = (targetRPM[i] > rpmDrop) ? (targetRPM[i] - rpmDrop) : 0;
                }
            }
            fromIdle = false;
        }
        break;

    case STATE_ACCELERATING:
        // clang-format off
       
        // If all motors are at target RPM, update the blaster's state to FULLSPEED.
        if ((!motors[0] || motorRPM[0] > firingRPM[0]) &&
            (!motors[1] || motorRPM[1] > firingRPM[1]) &&
            (!motors[2] || motorRPM[2] > firingRPM[2]) &&
            (!motors[3] || motorRPM[3] > firingRPM[3])
        ) {
            flywheelState = STATE_FULLSPEED;
            fromIdle =  true;
            println("STATE_FULLSPEED transition 1");
        } else if (loopStartTimer_us - revStartTime_us > 500000) { //500ms seems a reasonable timeout
            flywheelState = STATE_IDLE;
            resetFWControl();
            shotsToFire = 0;
            println("Error! Flywheels failed to reach target speed!");
        }
    
        break;
        // clang-format on

    case STATE_FULLSPEED:
        if (!revSwitch.isPressed() && shotsToFire == 0 && !firing)
        {
            flywheelState = STATE_IDLE;
            println("state transition: FULLSPEED to IDLE 1");
        }
        else if (shotsToFire > 0 || firing)
        {
            lastRevTime_ms = time_ms;

            if (shotsToFire > 0 && !firing && time_ms > pusherTimer_ms + solenoidRetractTime_ms)
            { // extend solenoid
                runtimeShotCounter++;
                displayShotCounter++;
                if (runtimeShotCounter % 10000 == 0){
                    displayShotCounter = 0;
                }
                updateRuntimeNow = true;
                pusher->drive(100, pusherReverseDirection);
                firing = true;
                shotsToFire = max(0, shotsToFire - 1);
                pusherTimer_ms = time_ms;
                solenoidExtendTime_ms = batteryVoltage_mv * solenoidVoltageTimeSlope + solenoidVoltageTimeIntercept; // assumes  a linear relationship between voltage and solenoid extend time
                println("solenoid extending");
            }
            else if (firing && time_ms > pusherTimer_ms + solenoidExtendTime_ms)
            { // retract solenoid
                pusher->coast();
                firing = false;
                pusherTimer_ms = time_ms;
                println("solenoid retracting");
            }
        }
        break;
    }
    if (enableFwControl){
        switch (flywheelControl){
            case PID_CONTROL:
            for (int i = 0; i < 4; i++)
            {
                if (motors[i])
                {
                
                    esc[i]->getTelemetryErpm(&motorRPMRaw[i]);
                    motorRPMRaw[i] /= (MOTOR_POLES / 2); // convert eRPM to RPM
                    
                    // reject impossible rpm readings
                    if (motorRPMRaw[i] * 1000 > motorKv * batteryVoltage_mv) {
                        //assign to last valid filtered rpm reading
                        motorRPMRaw[i] = motorRPM[i];
                    }
                    // do some filtering
                    motorRPMFilter[i] += motorRPMRaw[i];
                    motorRPM[i] = (motorRPMFilter[i] + half) >> EMAFilter; // 1st-order exponential moving average
                    motorRPMFilter[i] -= motorRPM[i];


                    PIDError[i] = targetRPM[i] - motorRPM[i];
                    
                    PIDIntegral[i] += PIDError[i] * loopTime_us / 1000000.0;
                    
                    int16_t openLoopThrottle = max(min(maxThrottle, maxThrottle * targetRPM[i] / batteryVoltage_mv * 1000 / motorKv), 0);
                    // use iTerm to save some memory for the next
                    if (isBatteryAdcDefined){
                        iTerm[i] = (openLoopThrottle+20)/KI;
                    } else {
                        iTerm[i] = (openLoopThrottle+100)/KI;
                    }
                    PIDIntegral[i] = constrain(PIDIntegral[i], - iTerm[i], iTerm[i]);
                    //overwrite iTerm with real value
                    iTerm[i] = PIDIntegral[i] * KI;
                    
                    dTerm[i] = KD * ((PIDError[i] - PIDErrorPrior[i]) * 1000000.0 / loopTime_us);
                    dTerm[i] = constrain(dTerm[i], -2000,2000);

                    if (targetRPM[i] == 0) {
                    PIDOutput[i] = 0;
                    } else {
                    PIDOutput[i] = KP * PIDError[i] + iTerm[i] + dTerm[i];
                    }
                    
                    PIDErrorPrior[i] = PIDError[i];
                    esc[i]->sendThrottle(max(0, min(maxThrottle, static_cast<int32_t>(PIDOutput[i]))));

                }

            }
            break;
            case TBH_CONTROL:
                for (int i = 0; i < 4; i++)
                {
                    if (motors[i])
                    {
                        /*
                        so slightly confusing, but we use PIDIntegral for TBH variable, and KI for gain, and PIDOutput for our error accumulator, which we cap at 1999.
                        Just trying to reuse variables to save runtime memory
                        */
                        esc[i]->getTelemetryErpm(&motorRPM[i]);
                        motorRPM[i] /= (MOTOR_POLES / 2); // convert eRPM to RPM
                        
                        // reject impossible rpm readings
                        if (motorRPM[i] * 1000 > motorKv * batteryVoltage_mv) {
                            //assign to last valid filtered rpm reading
                            motorRPM[i] = motorRPMFilter[i];
                        }
                        motorRPMFilter[i] = motorRPM[i];

                        PIDError[i] = targetRPM[i] - motorRPM[i];
                        PIDOutput[i] += KI * PIDError[i]; // reset PID output


                        if (signbit(PIDError[i]) != signbit(PIDErrorPrior[i])) {
                            PIDOutput[i] = PIDIntegral[i] = .5 * (PIDOutput[i] + PIDIntegral[i]);
                            PIDErrorPrior[i] = PIDError[i];
                        }
                        
                        if (PIDOutput[i] > 1999) {
                            PIDOutput[i] = 1999; // prevent negative output and cap output
                        } else if (PIDOutput[i] < 0) {
                            PIDOutput[i] = 0;
                        }
                        // prevent output from being zero if non zero targetRPM since we don't want to hard brake if we overshoot for heat optimization
                        if ((flywheelState == STATE_ACCELERATING || flywheelState == STATE_FULLSPEED)  && targetRPM[i] != 0 && PIDOutput[i] < 1) {
                            PIDOutput[i] = 1;
                        }
                        esc[i]->sendThrottle(max(0, min(maxThrottle, static_cast<int32_t>(PIDOutput[i]))));
        
                    }

                }
                break;
        }
    } else {
        //we are spinning down or idling, just do open loop control
        for (int i = 0; i < 4; i++) {
            if (motors[i]) {
                esc[i]->getTelemetryErpm(&motorRPM[i]);
                motorRPM[i] /= (MOTOR_POLES / 2); // convert eRPM to RPM
                PIDOutput[i] = max(min(maxThrottle, maxThrottle * targetRPM[i] / batteryVoltage_mv * 1000 / motorKv), 0);
                esc[i]->sendThrottle(PIDOutput[i]);
            }
        }
    }
    
    logData();
    
    

    #ifdef USE_RPM_LOGGING
        // increment cache index if we still need to take data
        if (cacheIndex < rpmLogLength)
            cacheIndex++;

        // dump cache once full
        if (cacheIndex == rpmLogLength)
        {
            // print the CSV header
            for (int j = 0; j < 4; j++)
            {
                if (motors[j])
                {
                    print("Motor ");
                    print(j);
                    print(",");
                    print("TargetRPM ");
                    print(j);
                    print(",");
                    print("Throttle ");
                    print(j);
                    print(",");
                    print("value ");
                    print(j);
                    print(",");
                }
            }
            println("");

            // print the data
            for (uint16_t i = 0; i < rpmLogLength; i++)
            {
                for (int j = 0; j < 4; j++)
                {
                    if (motors[j])
                    {
                        print(rpmCache[i][j]);
                        print(",");
                        print(targetRpmCache[i][j]);
                        print(",");
                        print(throttleCache[i][j]);
                        print(",");
                        print(valueCache[i][j]);
                        print(",");
                    }
                }
                println("");
            }
            // increment cache index to prevent re-dumping
            cacheIndex++;
        }

#endif
    //update pusher driver
    pusher->update();

    loopTime_us = micros() - loopStartTimer_us; // 'us' is microseconds
    if (loopTime_us > targetLoopTime_us)
    {
        print("loop over time, ");
        println(loopTime_us);
    }
    else
    {
        delayMicroseconds(max((long)(0), (long)(targetLoopTime_us - loopTime_us)));
        loopTime_us = targetLoopTime_us; 
    }

    return true;
}

void updateFiringMode()
{
    if (selectFireType == NO_SELECT_FIRE)
    {
        return;
    }
    if (pinDefined(select0Pin))
    {
        select0.update();
        if (select0.isPressed())
        {
            firingMode = 0;
            return;
        }
    }
    if (pinDefined(select1Pin))
    {
        select1.update();
        if (select1.isPressed())
        {
            firingMode = 1;
            return;
        }
    }
    if (pinDefined(select2Pin))
    {
        select2.update();
        if (select2.isPressed())
        {
            firingMode = 2;
            return;
        }
    }
    if (selectFireType == SWITCH_SELECT_FIRE)
    { // if BUTTON_SELECT_FIRE then don't change modes
        firingMode = defaultFiringMode;
        return;
    }
}

// call this function to reset PID integral values, or reset I for TBH control
void resetFWControl()
{
    switch (flywheelControl) {
    case PID_CONTROL:
        for (int i = 0; i < 4; i++) {
            if (motors[i]) {
                PIDOutput[i] = 0;
                PIDIntegral[i] = 0; // stop reset PID
            }
        }
        break;
    case TBH_CONTROL:
        for (int i = 0; i < 4; i++) {
            if (motors[i]) {
                PIDIntegral[i] = 0; // reset TBH to target RPM value
            }
        }
        break;
    }
    return;
}

void setup1(){
    if(hasDisplay){
        while (!display.begin(SSD1306_SWITCHCAPVCC, SCREEN_ADDRESS)) {
            delay(100);
        }
        // Clear the buffer
        display.clearDisplay();
        display.setTextSize(1);
        display.setTextColor(SSD1306_WHITE);
        if (rotateDisplay){
            display.setRotation(2);
        } else {
            display.setRotation(0);
        }
    }
}

void loop1(){
    if (hasDisplay){
        
        if (doDisplayString)
        {
            if (clearDisplay)
            {
                display.clearDisplay();
            }
            display.setCursor(cursorX, cursorY);
            display.println(displayString);
            display.display();
            doDisplayString = false;
        }

        if (doBootup){
            display.clearDisplay();
            display.drawBitmap(0, 0, splash, SCREEN_WIDTH, SCREEN_HEIGHT, 1);
            display.display();
            doBootup = false;
            display.setCursor(0, 56);
            display.setTextSize(1);
            display.print("Trifolium v" + String(MAJOR_VERSION) + "." + String(MINOR_VERSION) + "." + String(PATCH_VERSION));
            display.display();
        }

        unsigned long lastUpdated = 0;
        while (showRuntimeInfo){
            if (millis() - lastUpdated > 100 || updateRuntimeNow){
                //show firing mode
                display.clearDisplay();
                display.setCursor(0, 56);
                display.setTextSize(1);
                display.print(fireModeStrings[firingMode]);
                display.drawFastHLine(0, 15, 128, 1);
                //show motor target rpm
                //cover the two normal cases of  esc 2/4 and 1/3, and 2 motor operation
                u8 motorCount = 0;
                for (int i = 0; i < 4; i++){
                    if (motors[i]){
                        motorCount++;
                    }
                }
                if (motorCount == 2){
                    // assume motors are set to same speed
                    for (int i = 0; i < 4; i++){
                        if (motors[i]){
                            String motorRpmString = String(revRPM[i]/1000) + "K";
                            display.setCursor(128 - motorRpmString.length() * 6 - 1, 56);
                            display.print(motorRpmString);
                            break;
                        }
                    }
                } else  if (motorCount == 4){
                    if (revRPM[0] == revRPM[1] && revRPM[1] == revRPM[2] && revRPM[2] == revRPM[3]){
                        String motorRpmString = String(revRPM[0]/1000) + "K";
                        display.setCursor(128 - motorRpmString.length() * 6 - 1, 56);
                        display.print(motorRpmString);
                    } else {
                        //assume esc 2/4 and 1/3
                        String motorRpmString = String(revRPM[0]/1000) + "K|" + String(revRPM[1]/1000) + "K";
                        display.setCursor(128 - motorRpmString.length() * 6 - 1, 56);
                        display.print(motorRpmString);
                    }
                }
                display.drawFastHLine(0, 54, 128, 1);
                //show shot counter
                display.setTextSize(5);
                String displayShotCounterString(displayShotCounter);
                display.setCursor(128 - (displayShotCounterString.length() * 32), 18);
                display.print(displayShotCounterString);

                //show battery voltage
                if (isBatteryAdcDefined){
                    display.setTextSize(1);
                    String batteryVoltageString = String(batteryVoltage_mv / 1000.0, 1) + "V";
                    display.setCursor(128 - (batteryVoltageString.length() * 6), 5);
                    display.print(batteryVoltageString);
                }
                
                //display blaster name
                display.setTextSize(1);
                display.setCursor(0, 5);
                display.print(blasterName);
                display.print("|P ");
                display.print(fpsMode);
                display.display();

                updateRuntimeNow = false;
                lastUpdated = millis();
            }
        }

        if (doMenu){

        }
    }
    
}

void displayText(String str, int curX, int curY, bool clearScreen)
{
    if (hasDisplay)
    {
        displayString = str;
        cursorX = curX;
        cursorY = curY;
        clearDisplay = clearScreen;
        doDisplayString = true;
    }
}
