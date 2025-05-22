#include <Arduino.h>
#include <PIO_DShot.h>
#include "../lib/Bounce2/src/Bounce2.h"
#include "types.h"


#define PIN 10
#define MOTOR_POLES 14


/*
BidirDShotX1 *esc;
uint16_t throttle = 0;
uint32_t rpm = 0;

void setup() {
	Serial.begin(115200);

// initialize the ESC. This cannot be done globally, because we need to have the CPU running and tell us the frequency. Trying that crashed it for me. Also, do not call the constructor before you set the final clock speed on your CPU. If you change the clock speed, you should be fine by just destroying the previous DShot object and recreating it into the same pointer.
// if you need more than one output, just use multiple BidirDShotX1 objects with a different pin for each. It is recommended to dedicate an entire PIO block to Bidir dshot, because it takes almost the full instruction table. Up to 4 motors can be assigned to one PIO block, and if that's not enough, just create more objects on the second PIO block
	esc = new BidirDShotX1(PIN);
// there are some optional arguments: speed (e.g. 600 for DShot600), pio block (e.g. pio0 for the first PIO block), and a fixed SM (-1 for automatic selection).
// speeds are supported from 150-4800, though only 300, 600 or 1200 are recommended. PIO block has to be pio0 or pio1. SM can be 0-3, or -1 for automatic. If there's no SM free on this PIO, or you try to force an already claimed PIO, initialization will fail. Check the initError() function if there was an error initializing. You can go into the config.h file of the library and set the DEBUG_DSHOT, then you can see some Serial prints with more information.
}

void loop() {
// You need to space out the packets: https://github.com/bastian2001/pico-bidir-dshot/wiki/Timing-of-packets
	delayMicroseconds(200);

// call this function at minimum 87µs after you sent the last throttle, to receive the most current eRPM packet.
	esc->getTelemetryErpm(&rpm);
// convert eRPM to RPM
	rpm /= MOTOR_POLES / 2; // eRPM = RPM * poles/2

// send a throttle value between 0 (0% = stop) and 2000 (100%)
	esc->sendThrottle(throttle);

// print the throttle and RPM every 100ms
	static uint32_t lastTime = 0;
	if (millis() - lastTime > 100) {
		lastTime = millis();
		Serial.print(throttle);
		Serial.print("\t");
		Serial.println(rpm);
	}

	if (Serial.available()) {
		delay(3); // wait for the rest of the input
		String s = "";
		while (Serial.available()) {
			s += (char)Serial.read();
		}
		int32_t t = s.toInt();
// constrain limits the throttle value t to a max of 2000, and a min of 0. While the sendThrottle function also checks that you don't have anything >2000, it acts only as a one way limit because the variable th
		t = constrain(t, 0, 2000);
		throttle = t;
	}
}
*/
#include "../lib/Bounce2/src/Bounce2.h"
#include "CONFIGURATION.h"

uint32_t loopStartTimer_us = micros();
uint32_t loopTime_us = targetLoopTime_us;
uint32_t time_ms = millis();
uint32_t lastRevTime_ms = 0; // for calculating idling
uint32_t pusherTimer_ms = 0;
int32_t revRPM[4]; // stores value from revRPMSet on boot for current firing mode
int32_t idleTime_ms; // stores value from idleTimeSet_ms on boot for current firing mode
int32_t targetRPM[4] = { 0, 0, 0, 0 }; // stores current target rpm
int32_t firingRPM[4];
int32_t throttleValue[4] = { 0, 0, 0, 0 }; // scale is 0 - 2000
uint32_t currentSpindownSpeed = 0;
uint16_t burstLength; // stores value from burstLengthSet for current firing mode
burstFireType_t burstMode; // stores value from burstModeSet for current firing mode
int8_t firingMode = 0; // current firing mode
int8_t fpsMode = 0; // copy of firingMode locked at boot
bool fromIdle;
int32_t dshotValue = 0;
int16_t shotsToFire = 0;
flywheelState_t flywheelState = STATE_IDLE;
bool firing = false;
bool reverseBraking = false;
bool pusherDwelling = false;
uint32_t batteryADC_mv = 0;
int32_t batteryVoltage_mv = 14800;
int32_t voltageBuffer[voltageAveragingWindow] = { 0 };
int voltageBufferIndex = 0;
int32_t pusherShunt_mv = 0;
int32_t pusherCurrent_ma = 0;
int32_t pusherCurrentSmoothed_ma = 0;
const int32_t maxThrottle = 1999;
int32_t motorRPM[4] = { 0, 0, 0, 0 };
int32_t fullThrottleRpmThreshold[4] = { 0, 0, 0, 0 };
bool wifiState = false;
// String telemBuffer = "";
int8_t telemMotorNum = -1; // 0-3
uint32_t revStartTime_us = 0;
uint32_t triggerTime_ms = 0;
int32_t tempRPM;
bool currentlyLogging = false;

// closed loop variables
int32_t PIDError[4];
int32_t PIDErrorPrior[4];
int32_t closedLoopRPM[4];
int32_t PIDOutput[4];
int32_t PIDIntegral = 0;

Bounce2::Button revSwitch = Bounce2::Button();
Bounce2::Button triggerSwitch = Bounce2::Button();
Bounce2::Button cycleSwitch = Bounce2::Button();
Bounce2::Button button = Bounce2::Button();
Bounce2::Button select0 = Bounce2::Button();
Bounce2::Button select1 = Bounce2::Button();
Bounce2::Button select2 = Bounce2::Button();




void updateFiringMode();

void setup()
{
    Serial.begin(460800);
    Serial.println("Booting");

    // Serial2.begin(115200, SERIAL_8N1, board.telem, -1);
    // pinMode(board.telem, INPUT_PULLUP);

    if (revSwitchPin) {
        revSwitch.attach(revSwitchPin, INPUT_PULLUP);
        revSwitch.interval(debounceTime_ms);
        revSwitch.setPressedState(revSwitchNormallyClosed);
    }
    if (triggerSwitchPin) {
        triggerSwitch.attach(triggerSwitchPin, INPUT_PULLUP);
        triggerSwitch.interval(debounceTime_ms);
        triggerSwitch.setPressedState(triggerSwitchNormallyClosed);
    }
    if (cycleSwitchPin) {
        cycleSwitch.attach(cycleSwitchPin, INPUT_PULLUP);
        cycleSwitch.interval(pusherDebounceTime_ms);
        cycleSwitch.setPressedState(cycleSwitchNormallyClosed);
    }
    if (selectFireType != NO_SELECT_FIRE) {
        if (select0Pin) {
            select0.attach(select0Pin, INPUT_PULLUP);
            select0.interval(debounceTime_ms);
            select0.setPressedState(false);
        }
        if (select1Pin) {
            select1.attach(select1Pin, INPUT_PULLUP);
            select1.interval(debounceTime_ms);
            select1.setPressedState(false);
        }
        if (select2Pin) {
            select2.attach(select2Pin, INPUT_PULLUP);
            select2.interval(debounceTime_ms);
            select2.setPressedState(false);
        }
    }

    // change FPS using select fire switch position at boot time
    if (variableFPS) {
        updateFiringMode();
    }

    fpsMode = firingMode;
    Serial.print("fpsMode: ");
    Serial.println(fpsMode);
    for (int i = 0; i < 4; i++) {
        if (motors[i]) {
            revRPM[i] = revRPMset[fpsMode][i];
            firingRPM[i] = max(revRPM[i] - firingRPMTolerance, minFiringRPM);
            fullThrottleRpmThreshold[i] = revRPM[i] - fullThrottleRpmTolerance;
        }
    }
    idleTime_ms = idleTimeSet_ms[fpsMode];


}

void loop()
{
    loopStartTimer_us = micros();
    time_ms = millis();
    if (revSwitchPin) {
        revSwitch.update();
    }
    if (triggerSwitchPin) {
        triggerSwitch.update();
    }
    updateFiringMode();
    // changes burst options
    burstLength = burstLengthSet[firingMode];
    burstMode = burstModeSet[firingMode];

    // Transfer data from telemetry serial port to telemetry serial buffer:
    // while (Serial2.available()) {
    //     telemBuffer += Serial2.read(); // this doesn't seem to work - do we need 1k pullup resistor? also is this the most efficient way to do this?
    // }
    // Then parse serial buffer, if serial buffer contains complete packet then update motorRPM value, clear serial buffer, and increment telemMotorNum to get the data for the next motor
    // will we be able to detect the gaps between packets to know when a packet is complete? Need to test and see
    //    Serial.println(telemBuffer);

    if (triggerSwitch.pressed() || (burstMode == BINARY && triggerSwitch.released() && time_ms < triggerTime_ms + binaryTriggerTimeout_ms)) { // pressed and released are transitions, isPressed is for state
        Serial.print(time_ms);
        if (triggerSwitch.pressed()) {
            Serial.print(" trigger pressed, burstMode ");
        } else if (burstMode == BINARY && triggerSwitch.released() && time_ms < triggerTime_ms + binaryTriggerTimeout_ms) {
            Serial.print(" binary trigger released, burstMode ");
        }
        triggerTime_ms = time_ms;
        Serial.print(burstMode);
        Serial.print(" shotsToFire before ");
        Serial.print(shotsToFire);
        if (burstMode == AUTO) {
            shotsToFire = burstLength;
        } else {
            if (shotsToFire < burstLength || shotsToFire == 1) {
                shotsToFire += burstLength;
            }
        }
        Serial.print(" after ");
        Serial.println(shotsToFire);
    } else if (triggerSwitch.released()) {
        if (burstMode == AUTO && shotsToFire > 1) {
            shotsToFire = 1;
        }
    }

    switch (flywheelState) {

    case STATE_IDLE:
        if (batteryVoltage_mv < lowVoltageCutoff_mv && throttleValue[0] == 0 && loopStartTimer_us > 2000000) {
            digitalWrite(board.flywheel, LOW); // cut power to ESCs and pusher
            Serial.print("Battery low, shutting down! ");
            Serial.print(batteryVoltage_mv);
            Serial.println("mv");
        }

        if (shotsToFire > 0 || revSwitch.isPressed()) {
            revStartTime_us = loopStartTimer_us;
            memcpy(targetRPM, revRPM, sizeof(targetRPM)); // Copy revRPM to targetRPM
            lastRevTime_ms = time_ms;
            flywheelState = STATE_ACCELERATING;
            currentSpindownSpeed = 0; // reset spindownSpeed
        } else if (time_ms < lastRevTime_ms + idleTime_ms && lastRevTime_ms > 0) { // idle flywheels
            if (currentSpindownSpeed < spindownSpeed) {
                currentSpindownSpeed += 1;
            }
            for (int i = 0; i < 4; i++) {
                if (motors[i]) {
                    targetRPM[i] = max(targetRPM[i] - static_cast<int32_t>((currentSpindownSpeed * loopTime_us) / 1000), idleRPM[i]);
                }
            }
        } else { // stop flywheels
            if (currentSpindownSpeed < spindownSpeed) {
                currentSpindownSpeed += 1;
            }
            for (int i = 0; i < 4; i++) {
                if (motors[i] && targetRPM[i] != 0) {
                    targetRPM[i] = max(targetRPM[i] - static_cast<int32_t>((currentSpindownSpeed * loopTime_us) / 1000), 0);
                }
            }
            PIDIntegral = 0;
            fromIdle = false;
        }
        break;

    case STATE_ACCELERATING:
        // clang-format off
        if (flywheelControl != OPEN_LOOP_CONTROL && time_ms > lastRevTime_ms + (fromIdle ? minFiringDelayIdleSet_ms[fpsMode] : minFiringDelaySet_ms[fpsMode])) {
            // If all motors are at target RPM, update the blaster's state to FULLSPEED.
            if ((!motors[0] || motorRPM[0] > firingRPM[0]) &&
                (!motors[1] || motorRPM[1] > firingRPM[1]) &&
                (!motors[2] || motorRPM[2] > firingRPM[2]) &&
                (!motors[3] || motorRPM[3] > firingRPM[3])
            ) {
                flywheelState = STATE_FULLSPEED;
                fromIdle =  true;
                Serial.println("STATE_FULLSPEED transition 1");
            } else if (loopStartTimer_us - revStartTime_us > 2000000) {
                flywheelState = STATE_IDLE;
                shotsToFire = 0;
                Serial.println("Error! Flywheels failed to reach target speed!");
            }
        }
        if ((flywheelControl == OPEN_LOOP_CONTROL
            || (timeOverrideWhenIdling &&
                fromIdle &&
                (!motors[0] || motorRPM[0] > 100) &&
                (!motors[1] || motorRPM[1] > 100) &&
                (!motors[2] || motorRPM[2] > 100) &&
                (!motors[3] || motorRPM[3] > 100)
                )
            )
            && time_ms > lastRevTime_ms + (fromIdle ? firingDelayIdleSet_ms[fpsMode] : firingDelaySet_ms[fpsMode])) {
                flywheelState = STATE_FULLSPEED;
                fromIdle = true;
                Serial.print(time_ms);
                Serial.println(" STATE_FULLSPEED transition, firingDelay time elapsed");
        }
        break;
        // clang-format on

    case STATE_FULLSPEED:
        if (!revSwitch.isPressed() && shotsToFire == 0 && !firing) {
            flywheelState = STATE_IDLE;
            Serial.println("state transition: FULLSPEED to IDLE 1");
        } else if (shotsToFire > 0 || firing) {
            lastRevTime_ms = time_ms;

                if (shotsToFire > 0 && !firing && time_ms > pusherTimer_ms + solenoidRetractTime_ms) { // extend solenoid
                    pusher->drive(100, pusherReverseDirection);
                    firing = true;
                    shotsToFire = max(0, shotsToFire - 1);
                    pusherTimer_ms = time_ms;
                    Serial.println("solenoid extending");
                } else if (firing && time_ms > pusherTimer_ms + solenoidExtendTime_ms) { // retract solenoid
                    pusher->coast();
                    firing = false;
                    pusherTimer_ms = time_ms;
                    Serial.println("solenoid retracting");
                }
        }
        break;
    }
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



 
        for (int i = 0; i < 4; i++) {
            if (motors[i]) {
                PIDError[i] = targetRPM[i] - motorRPM[i];

                PIDOutput[i] = KP * PIDError[i] + KI * (PIDIntegral + PIDError[i] * loopTime_us / 1000000) + KD * (PIDError[i] - PIDErrorPrior[i]) / loopTime_us * 1000000;
                closedLoopRPM[i] = PIDOutput[i] + motorRPM[i];

                if (throttleValue[i] == 0) {
                    throttleValue[i] = min(maxThrottle, maxThrottle * closedLoopRPM[i] / batteryVoltage_mv * 1000 / motorKv);
                } else {
                    throttleValue[i] = max(min(maxThrottle, maxThrottle * closedLoopRPM[i] / batteryVoltage_mv * 1000 / motorKv),
                        throttleValue[i] - 1);
                }

                PIDErrorPrior[i] = PIDError[i];
                PIDIntegral += PIDIntegral + PIDError[i] * loopTime_us / 1000000;
            }
        }


        for (int i = 0; i < 4; i++) {
            if (motors[i]) {
                if (dshotBidirectional == ENABLE_BIDIRECTION) {
                    tempRPM = static_cast<int32_t>(dshot[i].get_dshot_RPM());
                    if (tempRPM > 0) { // todo: rate of change filtering
                        motorRPM[i] = tempRPM;
                    }
                }
                if (throttleValue[i] == 0) {
                    dshotValue = 0;
                } else {
                    dshotValue = throttleValue[i] + 48;
                }
                if (i == telemMotorNum) {
                    dshot[i].send_dshot_value(dshotValue, ENABLE_TELEMETRIC);
                } else {
                    dshot[i].send_dshot_value(dshotValue, NO_TELEMETRIC);
                }
            }
        }


    loopTime_us = micros() - loopStartTimer_us; // 'us' is microseconds
    if (loopTime_us > targetLoopTime_us) {
        Serial.print("loop over time, ");
        Serial.println(loopTime_us);
    } else {
        delayMicroseconds(max((long)(0), (long)(targetLoopTime_us - loopTime_us)));
    }
}

void updateFiringMode()
{
    if (selectFireType == NO_SELECT_FIRE) {
        return;
    }
    if (select0Pin) {
        select0.update();
        if (select0.isPressed()) {
            firingMode = 0;
            return;
        }
    }
    if (select1Pin) {
        select1.update();
        if (select1.isPressed()) {
            firingMode = 1;
            return;
        }
    }
    if (select2Pin) {
        select2.update();
        if (select2.isPressed()) {
            firingMode = 2;
            return;
        }
    }
    if (selectFireType == SWITCH_SELECT_FIRE) { // if BUTTON_SELECT_FIRE then don't change modes
        firingMode = defaultFiringMode;
        return;
    }
}
