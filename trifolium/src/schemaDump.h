#pragma once
#include <Arduino.h>

void dumpSchema();

// True if it moved any value into its bounds.
bool clampAllSettings();

class MenuItem;
uint8_t fireModeEditorIndex();
void setFireModeEditorIndex(uint8_t index);
uint8_t fireModeEditorFieldCount();
MenuItem* fireModeEditorField(uint8_t index);
uint8_t selectableBurstModeCount();
