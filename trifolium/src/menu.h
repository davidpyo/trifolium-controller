#include "Arduino.h"
#include "menuItem.h"

#define DEFAULT_MAX_RPM (HW_VERSION == 2 ? 53000 : 60000)

extern MenuItem *mainMenu;
extern MenuItem *firstBootMenu;
extern MenuItem *onboardingMenu;
extern MenuItem *openedMenu;
extern uint8_t profileColor[3];
extern char profileName[16];
extern uint16_t profileColor565;

extern uint8_t rotationTickSensitivity;
extern const char rotationSensitivityStrings[3][10];

void initMenu();
bool saveAndClose(MenuItem *item);
void loadSettings();