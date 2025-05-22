#ifndef __types_h_
#define __types_h_
#include <Arduino.h>

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

enum burstFireType_t {
    AUTO,
    BURST,
    BINARY
};

#endif
