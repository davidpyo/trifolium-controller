#include <Arduino.h>
#include <PIO_DShot.h>
#include "../lib/Bounce2/src/Bounce2.h"
#include "types.h"
#include "fetDriver.h"
#include "drvDriver.h"
#include "elapsedMillis.h"
#include "pico/stdlib.h"
#include "CONFIGURATION.h"

// elapsedMicros pidLoopTimer_us;
elapsedMicros revStartTime_us;
elapsedMillis lastRevTime_ms;

uint32_t loopStartTimer_us = micros();
int32_t loopTime_us = targetLoopTime_us;
uint32_t lastMainLoopTime = millis();
uint32_t time_ms = millis();
// uint32_t lastRevTime_ms = 0; // for calculating idling
uint32_t pusherTimer_ms = 0;
// uint32_t revStartTime_us = 0;
uint32_t triggerTime_ms = 0;

uint32_t revRPM[4];                   // stores value from revRPMSet on boot for current firing mode
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
uint32_t batteryADC_mv = 0;
int32_t batteryVoltage_mv = 14800;
int32_t voltageBuffer[voltageAveragingWindow] = {0};
int voltageBufferIndex = 0;
int32_t pusherShunt_mv = 0;
int32_t pusherCurrent_ma = 0;
int32_t pusherCurrentSmoothed_ma = 0;
const int32_t maxThrottle = 1999;
uint32_t motorRPM[4] = {0, 0, 0, 0};
uint32_t fullThrottleRpmThreshold[4] = {0, 0, 0, 0};
Driver *pusher;
bool wifiState = false;
// String telemBuffer = "";
int8_t telemMotorNum = -1; // 0-3

int32_t tempRPM;
bool currentlyLogging = false;

// closed loop variables
int32_t PIDError[4];
int32_t PIDErrorPrior[4];
int32_t closedLoopRPM[4];
int32_t PIDOutput[4];
int32_t PIDIntegral[4] = {0, 0, 0, 0};

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
float valueCache[rpmLogLength][4] = {0}; // float gets converted to an integer [0, 1999]
uint16_t cacheIndex = rpmLogLength + 1;
#endif

void updateFiringMode();
bool fwControlLoop();
void mainFiringLogic();

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

void setup()
{
    if (printTelemetry)
    {
        Serial.begin(115200);
    }
    println("Booting");

    // Serial2.begin(115200, SERIAL_8N1, board.telem, -1);
    // pinMode(board.telem, INPUT_PULLUP);

    if (revSwitchPin)
    {
        revSwitch.attach(revSwitchPin, INPUT_PULLUP);
        revSwitch.interval(debounceTime_ms);
        revSwitch.setPressedState(revSwitchNormallyClosed);
    }
    if (triggerSwitchPin)
    {
        triggerSwitch.attach(triggerSwitchPin, INPUT_PULLUP);
        triggerSwitch.interval(debounceTime_ms);
        triggerSwitch.setPressedState(triggerSwitchNormallyClosed);
    }
    if (cycleSwitchPin)
    {
        cycleSwitch.attach(cycleSwitchPin, INPUT_PULLUP);
        cycleSwitch.interval(pusherDebounceTime_ms);
        cycleSwitch.setPressedState(cycleSwitchNormallyClosed);
    }
    if (selectFireType != NO_SELECT_FIRE)
    {
        if (select0Pin)
        {
            select0.attach(select0Pin, INPUT_PULLUP);
            select0.interval(debounceTime_ms);
            select0.setPressedState(false);
        }
        if (select1Pin)
        {
            select1.attach(select1Pin, INPUT_PULLUP);
            select1.interval(debounceTime_ms);
            select1.setPressedState(false);
        }
        if (select2Pin)
        {
            select2.attach(select2Pin, INPUT_PULLUP);
            select2.interval(debounceTime_ms);
            select2.setPressedState(false);
        }
    }


    pinMode(board.ESC_ENABLE, OUTPUT);
    digitalWrite(board.ESC_ENABLE, HIGH);

    switch (board.pusherDriverType)
    {
    case DRV_DRIVER:
        pusher = new Drv(board.drvPH, board.drvEN, board.drvNSLEEP, board.drvMOSI, board.drvMISO, board.drvNSCS, board.drvSCLK);
        break;
    case FET_DRIVER:
        pusher = new Fet(board.drvEN);
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
    idleTime_ms = idleTimeSet_ms[fpsMode];
}

void loop()
{
    loopStartTimer_us = micros();
    time_ms = millis();

    if (lastMainLoopTime != time_ms)
    { // run main loop roughly every 1 ms
        mainFiringLogic();
        lastMainLoopTime = time_ms;
    }

    fwControlLoop();

    /* move to core1
        batteryADC_mv = batteryADC.readMiliVolts();
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

    */
}

void mainFiringLogic()
{
    if (revSwitchPin)
    {
        revSwitch.update();
    }
    if (triggerSwitchPin)
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
}

bool fwControlLoop()
{
    switch (flywheelState)
    {

    case STATE_IDLE:
        if (batteryVoltage_mv < lowVoltageCutoff_mv && time_ms > 2000)
        {
            digitalWrite(board.ESC_ENABLE, LOW); // cut power to ESCs and pusher
            print("Battery low, shutting down! ");
            print(batteryVoltage_mv);
            println("mv");
        }

        if (shotsToFire > 0 || revSwitch.isPressed())
        {
            revStartTime_us = 0;
            // revStartTime_us = loopStartTimer_us;
            memcpy(targetRPM, revRPM, sizeof(targetRPM)); // Copy revRPM to targetRPM
            lastRevTime_ms = 0;
            flywheelState = STATE_ACCELERATING;
            currentSpindownSpeed = 0; // reset spindownSpeed

#ifdef USE_RPM_LOGGING
            cacheIndex = 0; // reset cache index to start logging
#endif

            for (int i = 0; i < 4; i++)
            {
                if (motors[i])
                {
                    PIDIntegral[i] = 0; // reset PID integral
                }
            }
        }
        else if (lastRevTime_ms < idleTime_ms && lastRevTime_ms > 0)
        { // idle flywheels
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
        } else if (revStartTime_us > 500000) { //500ms seems a reasonable timeout
            flywheelState = STATE_IDLE;
            for (int i = 0; i < 4; i++)
            {
                if (motors[i])
                {
                    PIDIntegral[i] = 0; // stop reset PID
                }
            }
            shotsToFire = 0;
            println("Error! Flywheels failed to reach target speed!");
        }
    
        break;
        // clang-format on

    case STATE_FULLSPEED:
        if (!revSwitch.isPressed() && shotsToFire == 0 && !firing)
        {
            flywheelState = STATE_IDLE;
            for (int i = 0; i < 4; i++)
            {
                if (motors[i])
                {
                    PIDIntegral[i] = 0; // stop reset PID
                }
            }
            println("state transition: FULLSPEED to IDLE 1");
        }
        else if (shotsToFire > 0 || firing)
        {
            lastRevTime_ms = 0;

            if (shotsToFire > 0 && !firing && time_ms > pusherTimer_ms + solenoidRetractTime_ms)
            { // extend solenoid
                pusher->drive(100, pusherReverseDirection);
                firing = true;
                shotsToFire = max(0, shotsToFire - 1);
                pusherTimer_ms = time_ms;
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

    for (int i = 0; i < 4; i++)
    {
        if (motors[i])
        {

            esc[i]->getTelemetryErpm(&motorRPM[i]);
            motorRPM[i] /= (MOTOR_POLES / 2); // convert eRPM to RPM

            PIDError[i] = targetRPM[i] - motorRPM[i];
            PIDIntegral[i] += PIDError[i] * loopTime_us / 1000000.0;
            if (targetRPM[i] == 0) {
            PIDOutput[i] = 0;
            } else {
            PIDOutput[i] = KP * PIDError[i] + KI * (PIDIntegral[i]) + KD * ((PIDError[i] - PIDErrorPrior[i]) * 1000000.0 / loopTime_us);
            }
            esc[i]->sendThrottle(max(0, min(maxThrottle, static_cast<int32_t>(PIDOutput[i]))));

            // if we have rpm logging enabled, add the most recent value to the cache
#ifdef USE_RPM_LOGGING
            if (cacheIndex < rpmLogLength)
            {
                rpmCache[cacheIndex][i] = motorRPM[i];
                targetRpmCache[cacheIndex][i] = targetRPM[i]; // mostly for reference
                throttleCache[cacheIndex][i] = (int16_t)((PIDOutput[i]));
                valueCache[cacheIndex][i] = PIDError[i];
            }
#endif

            PIDErrorPrior[i] = PIDError[i];
        }

    }

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
    if (select0Pin)
    {
        select0.update();
        if (select0.isPressed())
        {
            firingMode = 0;
            return;
        }
    }
    if (select1Pin)
    {
        select1.update();
        if (select1.isPressed())
        {
            firingMode = 1;
            return;
        }
    }
    if (select2Pin)
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
