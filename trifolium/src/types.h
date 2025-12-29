#ifndef __types_h_
#define __types_h_
#include <Arduino.h>

#define PIN_NOT_USED 255

// deriving from uint32_t etc. would result in problems with function overloading (e.g. when using the same function for i32 variables and int literals, the compiler expects a function for int and one for i32)
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

#define CHECK_TYPE_SIZE(type, expected) static_assert((sizeof(type)) == (expected), "Size of " #type " is not as expected.")

enum flywheelState_t {
    STATE_IDLE,
    STATE_ACCELERATING, // ACCELERATING = wheels not yet at full speed
    STATE_FULLSPEED, // REV = wheels at full speed
};

enum selectFireType_t {
    NO_SELECT_FIRE,
    SWITCH_SELECT_FIRE,
    BUTTON_SELECT_FIRE
};

enum flywheelControlType_t {
    //OPEN_LOOP_CONTROL,
    //TWO_LEVEL_CONTROL,
    PID_CONTROL,
    TBH_CONTROL,
};

enum burstFireType_t {
    AUTO,
    BURST,
    BINARY
};

enum pusherType_t {
    NO_PUSHER,
    PUSHER_MOTOR_CLOSEDLOOP,
    PUSHER_SOLENOID_OPENLOOP,
};

enum pusherDriverType_t {
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

enum dshot_min_delay_t {
    DSHOT_MIN_DELAY_300 = 1000,//167
    DSHOT_MIN_DELAY_600 = 113,  
    DSHOT_MIN_DELAY_1200 = 87, 
};

typedef struct {
    pusherDriverType_t pusherDriverType;
    uint8_t esc1;
    uint8_t esc2;
    uint8_t esc3;
    uint8_t esc4;
    uint8_t telem;

    // I2C Pins
    uint8_t I2C_SCL;
    uint8_t I2C_SDA;

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
    //drv communication
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

enum class BootReason {
	POR, // Power-on reset
	WATCHDOG,
	CLEAR_EEPROM,
	MENU,
	TO_ESC_PASSTHROUGH,
	FROM_ESC_PASSTHROUGH,
	FROM_BOOT_SELECTION
};

#endif
