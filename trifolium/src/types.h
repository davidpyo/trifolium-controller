#ifndef __types_h_
#define __types_h_
#include <Arduino.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

#define PIN_NOT_USED 255

// Highest RP2040 bank-0 GPIO. pinMode() silently ignores anything above it, so a stored pin in
// 30..254 would be an input that never attaches with nothing to say so - PinItem::clampToBounds()
// folds that range onto PIN_NOT_USED instead.
constexpr uint8_t MAX_GPIO_PIN = 29;

// deriving from uint32_t etc. would result in problems with function overloading (e.g. when using
// the same function for a u8 variable and an int literal, the compiler expects a function for int
// and one for u8)
typedef unsigned char u8;
typedef unsigned long long u64;

enum flywheelState_t
{
    STATE_IDLE,
    STATE_ACCELERATING, // ACCELERATING = wheels not yet at full speed
    STATE_FULLSPEED,    // REV = wheels at full speed
};

enum selectFireType_t
{
    NO_SELECT_FIRE,
    SWITCH_SELECT_FIRE,
    BUTTON_SELECT_FIRE,
    SCREEN_SELECT_FIRE, // no hardware at all - firingMode is only ever changed via the menu
};

enum flywheelControlType_t
{
    // OPEN_LOOP_CONTROL,
    // TWO_LEVEL_CONTROL,
    PID_CONTROL,
    TBH_CONTROL,
};

enum burstFireType_t
{
    AUTO,
    BURST,
    BINARY,
    SAFE,     // ignores trigger input entirely - a physical safety, not a firing style
    SEMI,     // always exactly 1 dart per trigger pull
    DEVOTION, // DPS ramps up the longer the trigger is held
    PLASMA,   // hold to charge on an exponential ramp, release when READY(n) fires n darts (1-3)
};

enum pusherType_t
{
    NO_PUSHER,
    PUSHER_SOLENOID_OPENLOOP,
};

// Which physical flywheel stage a motor belongs to - shared across all 3 RPM profiles.
enum motorStage_t
{
    STAGE_1, // pre-accelerates the dart, typically lower RPM to allow more torque/power
    STAGE_2, // final acceleration stage, typically higher RPM - not every blaster has one
};

// Whether RPM (Idle + all 3 RPM profiles) is edited per-motor or per-stage in the menu - a UI
// convenience gate only; storage is always the same per-motor arrays either way.
enum rpmModeType_t
{
    RPM_CUSTOM,
    RPM_STAGE,
};

// Home screen layout - see DisplayManager::renderTelemetry().
enum homeScreenDisplayMode_t
{
    HOME_COUNTER,
    HOME_FIRE_MODE,
    HOME_BOTH,
};

// What battery condition (if any) makes ledDataPin blink - see checkLowVoltageCutoff().
enum ledWarningMode_t
{
    LED_WARNING_NONE,      // LED stays steady on regardless of battery voltage
    LED_WARNING_LOW_BATT,  // blinks once the hard low-voltage cutoff trips
    LED_WARNING_WARN_BATT, // blinks at the earlier, non-cutoff warning threshold
};

// How the pusher is driven, as a stored setting. There is no "none" here on purpose: a device
// with no wiring returns from runUnconfiguredBoot() before anything reads the pusher at all, and a
// build with no pusher says so by leaving pusherFetPin unused.
enum pusherDrive_t : uint8_t
{
    PUSHER_DRIVE_FET, // a gate driven directly, on deviceSettings.pusherFetPin
    PUSHER_DRIVE_ESC, // one of the four ESC channels, picked by deviceSettings.pusherEscChannel
    PUSHER_DRIVE_COUNT,
};

// Which ESC channel the pusher is routed through when pusherDrive is PUSHER_DRIVE_ESC. Unused on a
// FET build, where the pusher pin is deviceSettings.pusherFetPin. See pusherPin() in main.cpp.
enum escChannel_t : uint8_t
{
    ESC_CH_1,
    ESC_CH_2,
    ESC_CH_3,
    ESC_CH_4,
    ESC_CH_COUNT,
};

// What holding a switch down at power-on does. Persisted as an integer - APPEND ONLY.
enum bootAction_t : uint8_t
{
    BOOT_ACTION_NONE,
    BOOT_ACTION_BOOTLOADER,      // USB mass-storage mode, for reflashing without the BOOTSEL button
    BOOT_ACTION_ESC_PASSTHROUGH, // hand the ESC pins to a host ESC configurator
    BOOT_ACTION_IDLE_HOLD,       // latch the flywheels at idle RPM for the rest of this session
    BOOT_ACTION_COUNT,
};

// Index into DeviceSettings::bootAction[]. Fixed order, and the order evaluateBootAction() checks
// them in, so the first held switch wins. Persisted positionally - APPEND ONLY.
enum bootButton_t : uint8_t
{
    BOOT_BTN_MENU,
    BOOT_BTN_TRIGGER,
    BOOT_BTN_REV,
    BOOT_BTN_CYCLE,
    BOOT_BTN_IDLE,
    BOOT_BTN_SELECT0,
    BOOT_BTN_SELECT1,
    BOOT_BTN_SELECT2,
    BOOT_BTN_COUNT,
};

// "no switch", for a caller naming one. Deliberately not a member of the enum above, which is
// persisted positionally.
constexpr uint8_t kNoBootButton = BOOT_BTN_COUNT;

// An ordinal like every other persisted enum, so it carries a name in the config and is bounds
// checked by the same reader. A stored value may also be a bare bit rate (DSHOT300 = 300), which
// dshotModeFromJson() accepts. APPEND ONLY.
enum dshot_mode_t : uint8_t
{
    DSHOT300,
    DSHOT600,
    DSHOT1200,
    DSHOT_MODE_COUNT,
};

// The bit rate to hand BidirDShotX1. Kept next to the enum so a new mode cannot be added without
// the rate it means being obvious.
inline uint16_t dshotRate(dshot_mode_t mode)
{
    switch (mode)
    {
    case DSHOT600: return 600;
    case DSHOT1200: return 1200;
    case DSHOT300:
    default: return 300;
    }
}

enum class BootReason
{
    POR, // Power-on reset
    WATCHDOG,
    CLEAR_EEPROM,
    MENU,
    TO_ESC_PASSTHROUGH,
    FROM_ESC_PASSTHROUGH,
    FROM_BOOT_SELECTION
};

extern int32_t batteryVoltageMax_mv[4]; // max battery voltage for 3S, 4S, 5S, 6S

enum batteryType_t
{
    BATTERY_3S = 0,
    BATTERY_4S = 1,
    BATTERY_5S = 2,
    BATTERY_6S = 3
};

inline uint8_t cellCount(batteryType_t batteryType)
{
    return batteryType + 3;
}

#endif
