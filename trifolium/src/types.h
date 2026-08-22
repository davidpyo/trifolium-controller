#ifndef __types_h_
#define __types_h_
#include <Arduino.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

#define PIN_NOT_USED 255

// deriving from uint32_t etc. would result in problems with function overloading (e.g. when using
// the same function for i32 variables and int literals, the compiler expects a function for int and
// one for i32)
typedef float f32;
typedef double f64;
typedef signed char i8;
typedef signed short i16;
typedef signed int i32;
typedef signed long long i64;
typedef unsigned char u8;
typedef unsigned short u16;
typedef unsigned int u32;
typedef unsigned long long u64;

#define CHECK_TYPE_SIZE(type, expected)                                                            \
    static_assert((sizeof(type)) == (expected), "Size of " #type " is not as expected.")

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
    SAFE, // ignores trigger input entirely - a physical safety, not a firing style
    SEMI, // always exactly 1 dart per trigger pull
};

inline const char* defaultBurstModeName(burstFireType_t mode)
{
    switch (mode)
    {
    case AUTO:
        return "AUTO";
    case BURST:
        return "BURST";
    case BINARY:
        return "BINARY";
    case SAFE:
        return "SAFE";
    case SEMI:
        return "SEMI";
    default:
        return "";
    }
}
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

// What battery condition (if any) makes board.LED_DATA blink - see checkLowVoltageCutoff().
enum ledWarningMode_t
{
    LED_WARNING_NONE,      // LED stays steady on regardless of battery voltage
    LED_WARNING_LOW_BATT,  // blinks once the hard low-voltage cutoff trips
    LED_WARNING_WARN_BATT, // blinks at the earlier, non-cutoff warning threshold
};

enum pusherDriverType_t
{
    NO_DRIVER,
    FET_DRIVER,
    DRV_DRIVER,
    ESC_DRIVER,
};

enum dshot_mode_t
{
    DSHOT300 = 300,
    DSHOT600 = 600,
    DSHOT1200 = 1200
};

enum dshot_min_delay_t
{
    DSHOT_MIN_DELAY_300 = 1000,  // 167
    DSHOT_MIN_DELAY_600 = 1000,  // 113
    DSHOT_MIN_DELAY_1200 = 1000, // 87
};

inline dshot_min_delay_t dshotMinDelayFor(dshot_mode_t mode)
{
    switch (mode)
    {
    case DSHOT600:
        return DSHOT_MIN_DELAY_600;
    case DSHOT1200:
        return DSHOT_MIN_DELAY_1200;
    case DSHOT300:
    default:
        return DSHOT_MIN_DELAY_300;
    }
}

typedef struct
{
    const char* boardName; // display-only, About screen
    pusherDriverType_t pusherDriverType;
    uint8_t esc1;
    uint8_t esc2;
    uint8_t esc3;
    uint8_t esc4;
    uint8_t telem;

    // I2C Pins
    uint8_t I2C_SCL;
    uint8_t I2C_SDA;
    i2c_inst_t* I2C_HW_BLK;

    // GPIO Pins
    uint8_t IO2;
    uint8_t IO5;
    uint8_t IO6;
    uint8_t IO1;
    uint8_t IO3;
    uint8_t IO4;
    //  ADC PINS
    uint8_t batteryADC;
    uint8_t escADC;
    uint8_t drvADC;
    // drv communication
    uint8_t drvNSLEEP;
    uint8_t drvEN;
    uint8_t drvPH;
    uint8_t drvMOSI;
    uint8_t drvMISO;
    uint8_t drvNSCS;
    uint8_t drvSCLK;

    uint8_t LED_DATA;
    uint8_t ESC_ENABLE;

} boards_t;

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
