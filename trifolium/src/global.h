#include "types.h"
#include "eepromImpl.h"
#include "menu.h"

#define MAJOR_VERSION 1
#define MINOR_VERSION 1
#define PATCH_VERSION 0

#define SCREEN_WIDTH 128 // OLED display width, in pixels
#define SCREEN_HEIGHT 64 // OLED display height, in pixels
#define SCREEN_ADDRESS 0x3C ///< See datasheet for Address; 0x3C 

extern BootReason bootReason; // Reason for booting
extern BootReason rebootReason; // Reason for rebooting (can be set right before an intentional reboot, WATCHDOG otherwise)
extern u64 powerOnResetMagicNumber; // Magic number to detect power-on reset (0xdeadbeefdeadbeef)


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
