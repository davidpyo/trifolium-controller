#include "menuItem.h"

bool MenuItem::settingsBeep = false;
bool MenuItem::settingsAreInEeprom = false;
uint8_t MenuItem::lastSettingsBeepMotor = 0;
uint32_t MenuItem::scheduledSettingsBeep = 0;
elapsedMillis MenuItem::lastSettingsBeepTimer = 0;
uint8_t MenuItem::scheduledBeepTone = 0;
bool MenuItem::enteredRotationNavigation = false;
int16_t MenuItem::lastTickCount = 0;
#if HW_VERSION == 2
bool MenuItem::settingsSolenoidClickFlag = false;
#endif

MenuItem::MenuItem(const VariableType varType, void *data, const int32_t defaultVal, const int32_t stepSize, const int32_t min, const int32_t max, const int32_t displayDivider, const uint8_t displayDecimals, const uint32_t eepromPos, const bool isProfileDependent, const char *identifier, const char *displayName, const char *description, const int32_t offset, const bool rebootOnChange, bool rollover)
	: varType(varType),
	  stepSizeI(stepSize),
	  minI(min),
	  maxI(max),
	  displayDivider(displayDivider),
	  displayDecimals(displayDecimals),
	  startEepromPos(eepromPos),
	  isProfileDependent(isProfileDependent),
	  identifier(identifier),
	  displayName(displayName),
	  description(description),
	  rebootOnChange(rebootOnChange),
	  itemType(MenuItemType::VARIABLE),
	  offsetI(offset),
	  data(data),
	  rollover(rollover) {
	switch (varType) {
	case VariableType::int32_t:
	case VariableType::uint32_t:
	case VariableType::FLOAT:
		memcpy(this->defaultVal, &defaultVal, 4);
		break;
	case VariableType::uint16_t:
	case VariableType::int16_t:
		memcpy(this->defaultVal, &defaultVal, 2);
		break;
	case VariableType::uint8_t:
	case VariableType::int8_t:
	case VariableType::BOOL:
		memcpy(this->defaultVal, &defaultVal, 1);
		break;
	default:
		break;
	}
}

MenuItem::MenuItem(const VariableType varType, float *data, const float defaultVal, const float stepSize, const float min, const float max, const uint8_t displayDecimals, const uint32_t eepromPos, const bool isProfileDependent, const char *identifier, const char *displayName, const char *description, const bool rebootOnChange, bool rollover)
	: varType(varType),
	  stepSizeF(stepSize),
	  minF(min),
	  maxF(max),
	  displayDecimals(displayDecimals),
	  startEepromPos(eepromPos),
	  isProfileDependent(isProfileDependent),
	  identifier(identifier),
	  displayName(displayName),
	  description(description),
	  rebootOnChange(rebootOnChange),
	  itemType(MenuItemType::VARIABLE),
	  data(data),
	  rollover(rollover) {
	memcpy(this->defaultVal, &defaultVal, 4);
}

MenuItem::MenuItem(const MenuItemType itemType, const char *identifier, const char *displayName, const char *description, const bool rebootOnChange)
	: itemType(itemType),
	  identifier(identifier),
	  displayName(displayName),
	  description(description),
	  startEepromPos(0),
	  isProfileDependent(false),
	  rebootOnChange(rebootOnChange) {
	if (itemType == MenuItemType::INFO) {
		this->focusable = false;
	} else {
		this->focusable = true;
	}
}

MenuItem::MenuItem(char *data, const uint8_t maxStringLength, const char *defaultVal, const uint32_t eepromPos, const bool isProfileDependent, const char *identifier, const char *displayName, const char *description, const bool rebootOnChange)
	: varType(VariableType::STRING),
	  startEepromPos(eepromPos),
	  isProfileDependent(isProfileDependent),
	  identifier(identifier),
	  displayName(displayName),
	  description(description),
	  rebootOnChange(rebootOnChange),
	  itemType(MenuItemType::VARIABLE),
	  data(data),
	  maxStringLength(MIN(maxStringLength, MENU_MAX_DEFAULT_DATA_SIZE)) {
	memcpy(this->defaultVal, defaultVal, this->maxStringLength);
	((char *)this->defaultVal)[this->maxStringLength - 1] = '\0';
	uint8_t len = strlen((char *)this->defaultVal);
	for (uint8_t i = len; i < this->maxStringLength; i++) {
		this->defaultVal[i] = '\0';
	}
}

MenuItem::MenuItem(bool *data, const bool defaultVal, const uint32_t eepromPos, const bool isProfileDependent, const char *identifier, const char *displayName, const char *description, const bool rebootOnChange)
	: varType(VariableType::BOOL),
	  startEepromPos(eepromPos),
	  isProfileDependent(isProfileDependent),
	  identifier(identifier),
	  displayName(displayName),
	  description(description),
	  rebootOnChange(rebootOnChange),
	  itemType(MenuItemType::VARIABLE),
	  data(data) {
	((bool *)this->defaultVal)[0] = defaultVal;
}

MenuItem::MenuItem(uint8_t *data, const uint8_t defaultVal, const uint32_t eepromPos, const uint8_t max, const char *lut, const uint8_t strSize, const bool isProfileDependent, const char *identifier, const char *displayName, const char *description, const bool rebootOnChange)
	: varType(VariableType::uint8_t_LUT),
	  stepSizeI(1),
	  maxI(max),
	  startEepromPos(eepromPos),
	  isProfileDependent(isProfileDependent),
	  identifier(identifier),
	  displayName(displayName),
	  description(description),
	  rebootOnChange(rebootOnChange),
	  itemType(MenuItemType::VARIABLE),
	  data(data),
	  lut(lut),
	  lutStringSize(strSize) {
	this->defaultVal[0] = defaultVal;
}

MenuItem *MenuItem::addChild(MenuItem *child) {
	if (child == nullptr) return this;
	if (child->parent == nullptr)
		child->setParent(this);
	this->children.push_back(child);
	return this;
}

MenuItem *MenuItem::setParent(MenuItem *parent) {
	this->parent = parent;
	return this;
}

MenuItem *MenuItem::search(const char *id) {
	if (strcmp(this->identifier, id) == 0) return this;
	for (uint8_t i = 0; i < this->children.size(); i++) {
		MenuItem *result = this->children[i]->search(id);
		if (result != nullptr) return result;
	}
	return nullptr;
}

void MenuItem::setVisible(bool visible) {
	if (this->parent != nullptr && this->visible != visible) {
		this->parent->triggerFullRedraw();
		this->visible = visible;
		this->parent->checkFocus();
	}
}

void MenuItem::init() {
	switch (this->itemType) {
	case MenuItemType::VARIABLE:
		if (MenuItem::settingsAreInEeprom && this->startEepromPos < EEPROM_SIZE) {
			switch (this->varType) {
			case VariableType::int32_t:
			case VariableType::uint32_t:
			case VariableType::FLOAT: {
				uint32_t addr = this->startEepromPos;
				if (this->isProfileDependent) {
					addr += selectedProfile * PROFILE_EEPROM_SIZE;
				}
				int32_t val;
				EEPROM.get(addr, val);
				memcpy(this->data, &val, 4);
			} break;
			case VariableType::uint16_t:
			case VariableType::int16_t: {
				uint32_t addr = this->startEepromPos;
				if (this->isProfileDependent) {
					addr += selectedProfile * PROFILE_EEPROM_SIZE;
				}
				int16_t val;
				EEPROM.get(addr, val);
				memcpy(this->data, &val, 2);
			} break;
			case VariableType::uint8_t:
			case VariableType::uint8_t_LUT:
			case VariableType::int8_t:
			case VariableType::BOOL: {
				uint32_t addr = this->startEepromPos;
				if (this->isProfileDependent) {
					addr += selectedProfile * PROFILE_EEPROM_SIZE;
				}
				int8_t val;
				EEPROM.get(addr, val);
				memcpy(this->data, &val, 1);
			} break;
			case VariableType::STRING: {
				uint32_t addr = this->startEepromPos;
				if (this->isProfileDependent) {
					addr += selectedProfile * PROFILE_EEPROM_SIZE;
				}
				for (uint8_t i = 0; i < this->maxStringLength; i++) {
					EEPROM.get(addr + i, ((char *)this->data)[i]);
				}
				((char *)this->data)[this->maxStringLength - 1] = '\0';
				uint8_t len = strlen((char *)this->data);
				for (uint8_t i = len; i < this->maxStringLength; i++) {
					((char *)this->data)[i] = '\0';
				}
			} break;
			}
		} else {
			switch (this->varType) {
			case VariableType::int32_t:
			case VariableType::uint32_t:
			case VariableType::FLOAT: {
				memcpy(this->data, this->defaultVal, 4);
				uint32_t addr = this->startEepromPos;
				if (this->startEepromPos >= EEPROM_SIZE) break;
				if (this->isProfileDependent) {
					for (uint8_t i = 0; i < MAX_PROFILE_COUNT; i++) {
						EEPROM.put(addr + i * PROFILE_EEPROM_SIZE, *(int32_t *)this->data);
					}
				} else {
					EEPROM.put(addr, *(int32_t *)this->data);
				}
			} break;
			case VariableType::uint16_t:
			case VariableType::int16_t: {
				memcpy(this->data, this->defaultVal, 2);
				uint32_t addr = this->startEepromPos;
				if (this->startEepromPos >= EEPROM_SIZE) break;
				if (this->isProfileDependent) {
					for (uint8_t i = 0; i < MAX_PROFILE_COUNT; i++) {
						EEPROM.put(addr + i * PROFILE_EEPROM_SIZE, *(int16_t *)this->data);
					}
				} else {
					EEPROM.put(addr, *(int16_t *)this->data);
				}
			} break;
			case VariableType::uint8_t:
			case VariableType::uint8_t_LUT:
			case VariableType::int8_t:
			case VariableType::BOOL: {
				memcpy(this->data, this->defaultVal, 1);
				uint32_t addr = this->startEepromPos;
				if (this->startEepromPos >= EEPROM_SIZE) break;
				if (this->isProfileDependent) {
					for (uint8_t i = 0; i < MAX_PROFILE_COUNT; i++) {
						EEPROM.put(addr + i * PROFILE_EEPROM_SIZE, *(int8_t *)this->data);
					}
				} else {
					EEPROM.put(addr, *(int8_t *)this->data);
				}
			} break;
			case VariableType::STRING: {
				uint32_t defaultStringLength = min(this->maxStringLength, strlen((char *)this->defaultVal) + 1); // +1 for null terminator
				memcpy(this->data, this->defaultVal, defaultStringLength);
				((char *)this->data)[this->maxStringLength - 1] = '\0';
				for (uint8_t i = defaultStringLength; i < this->maxStringLength; i++) {
					((char *)this->data)[i] = '\0';
				}
				uint32_t addr = this->startEepromPos;
				if (this->startEepromPos >= EEPROM_SIZE) break;
				if (this->isProfileDependent) {
					for (uint8_t i = 0; i < MAX_PROFILE_COUNT; i++) {
						for (uint8_t j = 0; j < this->maxStringLength; j++) {
							EEPROM.put(addr + i * PROFILE_EEPROM_SIZE + j, ((char *)this->data)[j]);
						}
					}
				} else {
					for (uint8_t i = 0; i < this->maxStringLength; i++) {
						EEPROM.put(addr + i, ((char *)this->data)[i]);
					}
				}
			} break;
			}
		}
		if (this->onChangeFunction != nullptr) {
			this->onChangeFunction(this);
		}
		this->redrawValue = true;
		break;
	case MenuItemType::SUBMENU: {
		for (uint8_t i = 0; i < this->children.size(); i++) {
			this->children[i]->init();
		}
	}
	}
}

void MenuItem::getNumberValueString(char buf[8]) {
	if (this->itemType != MenuItemType::VARIABLE || this->varType == VariableType::STRING || this->varType == VariableType::BOOL || this->varType == VariableType::uint8_t_LUT) {
		buf[0] = '\0';
		return;
	}
	float valF = 0;
	switch (this->varType) {
	case VariableType::int32_t:
		valF = *(int32_t *)this->data + this->offsetI;
		break;
	case VariableType::uint32_t:
		valF = *(uint32_t *)this->data + this->offsetI;
		break;
	case VariableType::FLOAT:
		valF = *(float *)this->data;
		break;
	case VariableType::uint16_t:
		valF = *(uint16_t *)this->data + this->offsetI;
		break;
	case VariableType::int16_t:
		valF = *(int16_t *)this->data + this->offsetI;
		break;
	case VariableType::uint8_t:
		valF = *(uint8_t *)this->data + this->offsetI;
		break;
	case VariableType::int8_t:
		valF = *(int8_t *)this->data + this->offsetI;
		break;
	};
	if (this->varType != VariableType::FLOAT)
		valF /= this->displayDivider;
	switch (this->varType) {
	case VariableType::int32_t:
	case VariableType::uint32_t:
	case VariableType::uint16_t:
	case VariableType::int16_t:
	case VariableType::uint8_t:
	case VariableType::int8_t:
	case VariableType::FLOAT: {
		snprintf(buf, 8, "%.*f", this->displayDecimals, valF);
	} break;
	}
}

void MenuItem::loop() {
	if (this->customLoop != nullptr) {
		if (!this->customLoop(this)) return;
	}
	bool deepestMenuItem = true;
	bool deepestFullDraw = true;
#if HW_VERSION == 1
	if (scheduledSettingsBeep && millis() >= scheduledSettingsBeep) {
		if (scheduledSettingsBeep + 300 > millis())
			makeSettingsBeep(scheduledBeepTone);
		scheduledSettingsBeep = 0;
	}
#elif HW_VERSION == 2
#endif
	switch (this->itemType) {
	case MenuItemType::SUBMENU: {
		if (!this->entered) return;
		for (auto c : this->children) {
			if (c->entered) {
				c->loop(); // loop nests down to the deepest entered item
				deepestMenuItem = false;
				if (c->itemType == MenuItemType::SUBMENU || c->itemType == MenuItemType::CUSTOM) {
					deepestFullDraw = false;
				}
				break;
			}
		}
	} break;
	case MenuItemType::VARIABLE:
	case MenuItemType::ACTION:
	case MenuItemType::INFO:
		deepestFullDraw = false;
		break;
	}

	if (deepestMenuItem) {
		if (enteredRotationNavigation) {
			if (lastTickCount != joystickRotationTicks && joystickMagnitude >= 85) {
// joystickMagnitude needed to prevent updates while letting the joystick snap back to center
#if HW_VERSION == 2
				if (settingsBeep) settingsSolenoidClickFlag = true;
#endif
				if (lastTickCount > joystickRotationTicks) {
					for (int32_t i = lastTickCount - joystickRotationTicks; i > 0; i--) {
						this->onUp();
					}
				} else {
					for (int32_t i = joystickRotationTicks - lastTickCount; i > 0; i--) {
						this->onDown();
					}
				}
				lastTickCount = joystickRotationTicks;
			}
			if (gestureUpdated && lastGesture.type == GESTURE_RELEASE) {
				enteredRotationNavigation = false;
				this->onExit();
			}
		} else if (gestureUpdated && (lastGesture.type == GESTURE_PRESS || lastGesture.type == GESTURE_HOLD)) {
			gestureUpdated = false;
			switch (lastGesture.direction) {
			case Direction::UP:
				this->onUp();
				break;
			case Direction::DOWN:
				this->onDown();
				break;
			case Direction::LEFT:
				this->onLeft();
				break;
			case Direction::RIGHT:
				this->onRight();
				break;
			case Direction::UP_LEFT:
				if (lastGesture.type != GESTURE_PRESS) break;
				if (this->itemType == MenuItemType::SUBMENU) {
					MenuItem *focusedChild = nullptr;
					for (uint8_t i = 0; i < this->children.size(); i++) {
						if (this->children[i]->focused) {
							focusedChild = this->children[i];
							break;
						}
					}
					if (focusedChild && focusedChild->itemType == MenuItemType::VARIABLE && focusedChild->varType != VariableType::BOOL && focusedChild->varType != VariableType::STRING && focusedChild->varType != VariableType::NONE) {
#if HW_VERSION == 1
						scheduleBeep(SETTINGS_BEEP_PERIOD, 1);
#elif HW_VERSION == 2
						beep(SETTINGS_BEEP_MIN_FREQ + SETTINGS_BEEP_FREQ_RANGE / 3);
#endif
						enteredRotationNavigation = true;
						lastTickCount = 0;
						focusedChild->onEnter();
					}
				} else if (this->itemType == MenuItemType::VARIABLE && this->varType != VariableType::BOOL && this->varType != VariableType::STRING && this->varType != VariableType::NONE) {
#if HW_VERSION == 1
					scheduleBeep(SETTINGS_BEEP_PERIOD, 1);
#elif HW_VERSION == 2
					beep(SETTINGS_BEEP_MIN_FREQ + SETTINGS_BEEP_FREQ_RANGE / 3);
#endif
					enteredRotationNavigation = true;
					lastTickCount = 0;
				}
				break;
			}
		}
	}
	if (deepestFullDraw && this->entered) { // in case onLeft etc. called for exit, entered is checked again
		SET_DEFAULT_FONT;
		tft.setTextColor(ST77XX_WHITE);
		this->drawFull();
	}
}

void MenuItem::onFocus() {
	DEBUG_PRINTF("Focusing %s\n", this->identifier);
	this->focusTimer = 0;
}

void MenuItem::onEnter() {
	DEBUG_PRINTF("Entering %s\n", this->identifier);
	if (this->onEnterFunction != nullptr) {
		if (!this->onEnterFunction(this)) return;
	}
	if (this->itemType == MenuItemType::VARIABLE && this->varType == VariableType::BOOL) {
		// confuse the compiler enough so it doesn't do bullshit
		// with *(bool *)this->data = !*(bool *)this->data; it was always changing between 255 and 254 if you had not initialized the bool, i.e. it only worked when the variable was 0 or 1, but not when it was anything else
		bool pre = *(bool *)this->data;
		uint8_t countOnes = 0;
		for (uint8_t i = 0; i < 8; i++) {
			if (pre & (1 << i)) countOnes++;
		}
		bool newVal = countOnes == 0;
		*(bool *)this->data = newVal; // don't enter into bools, just change them
		if (this->onChangeFunction != nullptr) {
			this->onChangeFunction(this);
		}
		this->redrawValue = true;
	} else {
		this->entered = true;
		this->charPos = 0;
		this->charDisplayStart = 0;
		this->fullRedraw = true;
		this->scrollTop = 0;
		if (this->itemType == MenuItemType::SUBMENU) {
			uint8_t size = this->children.size();
			bool focusedChild = false;
			for (uint8_t i = 0; i < size; i++) {
				MenuItem *c = this->children[i];
				if (c->focusable && c->visible && !focusedChild) {
					c->focused = true;
					focusedChild = true;
					c->onFocus();
				} else {
					c->focused = false;
				}
				if (c->entered) {
					c->entered = false;
				}
			}
		}
	}
}

void MenuItem::setFocusedChild(const char *identifier) {
	for (uint8_t i = 0; i < this->children.size(); i++) {
		if (strcmp(this->children[i]->identifier, identifier) == 0) {
			this->children[i]->focused = true;
			this->children[i]->onFocus();
		} else {
			this->children[i]->focused = false;
		}
	}
}

void MenuItem::triggerFullRedraw() {
	this->fullRedraw = true;
	for (auto child : this->children) {
		if (child->entered) {
			child->triggerFullRedraw();
		}
	}
}
void MenuItem::triggerRedrawValue() {
	this->redrawValue = true;
}

void MenuItem::drawNumberValue(const int16_t cY, uint16_t colorBg, uint16_t colorFg, uint8_t drawBg) {
	if (drawBg) {
#if HW_VERSION == 1
		tft.fillRect(MENU_START_VALUE_X, cY, 42, YADVANCE, colorBg);
#elif HW_VERSION == 2
		tft.fillRect(MENU_START_VALUE_X, cY, 80, YADVANCE, colorBg);
#endif
	}
	tft.setCursor(MENU_START_VALUE_X, cY);
	char buf[8];
	this->getNumberValueString(buf);
	tft.setTextColor(colorFg);
	tft.print(buf);
	tft.setTextColor(ST77XX_WHITE);
}
void MenuItem::drawBoolValue(const int16_t cY, uint16_t colorBg, uint16_t colorFg, uint8_t drawBg) {
	tft.setCursor(MENU_START_VALUE_X, cY);
	if (drawBg)
#if HW_VERSION == 1
		tft.fillRect(MENU_START_VALUE_X, cY, 18, YADVANCE, colorBg);
#elif HW_VERSION == 2
		tft.fillRect(MENU_START_VALUE_X, cY, 19, YADVANCE, colorBg);
#endif
	tft.setTextColor(colorFg);
	tft.print(*(bool *)this->data ? "ON" : "OFF");
	tft.setTextColor(ST77XX_WHITE);
}
void MenuItem::drawStringValue(const int16_t cY, uint16_t colorBg, uint16_t colorFg, uint8_t drawBg) {
	if (drawBg) {
#if HW_VERSION == 1
		tft.fillRect(109, cY, 42, 8, colorBg);
#elif HW_VERSION == 2
		tft.fillRect(MENU_START_VALUE_X, cY, 100, YADVANCE, colorBg);
#endif
	}
	tft.setCursor(MENU_START_VALUE_X, cY);
#if HW_VERSION == 1
	char buf[8];
	memcpy(buf, this->data, MIN(this->maxStringLength, 8));
	buf[7] = '\0';
#elif HW_VERSION == 2
	char buf[32] = {0};
	uint8_t len = 0;
	int16_t x = 0, y = 0;
	uint16_t width = 0, height = 0;
	tft.setTextWrap(false);
	while (width <= 100 && len < this->maxStringLength && len < 32) {
		buf[len] = ((char *)this->data)[len];
		len++;
		tft.getTextBounds(buf, 0, 0, &x, &y, &width, &height);
	}
	buf[len - 1] = '\0';
#endif
	tft.setTextColor(colorFg);
	tft.print(buf);
	tft.setTextColor(ST77XX_WHITE);
}
void MenuItem::drawLutValue(const int16_t cY, uint16_t colorBg, uint16_t colorFg, uint8_t drawBg) {
	if (drawBg) {
#if HW_VERSION == 1
		uint8_t maxLen = 0;
		for (uint8_t i = 0; i <= this->maxI; i++) {
			maxLen = MAX(maxLen, strlen(&this->lut[i * this->lutStringSize]));
		}
		if (maxLen < 8) {
			tft.fillRect(MENU_START_VALUE_X, cY, 42, YADVANCE, colorBg);
		} else {
			tft.fillRect(MENU_START_VALUE_X + 6 * 8 - maxLen * 6, cY, maxLen * 6, YADVANCE, colorBg);
		}
#elif HW_VERSION == 2
		tft.fillRect(MENU_START_VALUE_X, cY, 90, YADVANCE, colorBg);
#endif
	}
#if HW_VERSION == 1
	uint8_t len = strlen(&this->lut[*(uint8_t *)this->data * this->lutStringSize]);
	if (len < 8) {
		tft.setCursor(MENU_START_VALUE_X, cY);
	} else {
		tft.setCursor(MENU_START_VALUE_X + 6 * 8 - len * 6, cY); // Fire Mode: Continuous
	}
#elif HW_VERSION == 2
	tft.setCursor(MENU_START_VALUE_X, cY);
#endif
	tft.setTextColor(colorFg);
	tft.print(&this->lut[*(uint8_t *)this->data * this->lutStringSize]);
	tft.setTextColor(ST77XX_WHITE);
}
void MenuItem::drawEditableString(const int16_t cY) {
	uint8_t len = strlen((char *)this->data);
	if (this->charDisplayStart > this->charPos - 1) this->charDisplayStart = this->charPos - 1; // scroll left if needed
	if (this->charDisplayStart < 0) this->charDisplayStart = 0;
	uint8_t lengthPotential = this->maxStringLength - 2; // maximum selectable character (0-indexed)
	if (lengthPotential > len) lengthPotential = len;
	if (lengthPotential >= STRING_EDIT_VIEW_LENGTH) {
		if (this->charPos == lengthPotential) {
			this->charDisplayStart = lengthPotential - (STRING_EDIT_VIEW_LENGTH - 1);
		} else if (this->charPos > this->charDisplayStart + (STRING_EDIT_VIEW_LENGTH - 2)) {
			this->charDisplayStart = this->charPos - (STRING_EDIT_VIEW_LENGTH - 2);
		}
	}
	char buf[STRING_EDIT_VIEW_LENGTH + 1];
	memcpy(buf, ((char *)this->data) + this->charDisplayStart, MIN(this->maxStringLength, STRING_EDIT_VIEW_LENGTH));
	buf[STRING_EDIT_VIEW_LENGTH] = '\0';
	tft.setTextColor(tft.color565(150, 150, 150));
#if HW_VERSION == 1
	tft.fillRect(MENU_START_VALUE_X, cY, 42, 8, ST77XX_BLACK);
	tft.setCursor(MENU_START_VALUE_X, cY);
	tft.print(buf);
#elif HW_VERSION == 2
	tft.fillRect(MENU_START_VALUE_X, cY, 100, YADVANCE, ST77XX_BLACK);
	int cX = MENU_START_VALUE_X;
	// Bass11px is not monospace, so we have to print char by char
	for (uint8_t i = 0; buf[i] != '\0'; i++) {
		tft.setCursor(cX, cY);
		tft.print(buf[i]);
		cX += STRING_EDIT_CHAR_WIDTH;
	}
#endif
	uint8_t nullSearchBoundHigh = STRING_EDIT_VIEW_LENGTH - 1;
	uint8_t nullSearchBoundLow = 0;
	if (this->charDisplayStart != 0) {
		nullSearchBoundLow = 1;
		tft.fillRect(MENU_START_VALUE_X, cY, STRING_EDIT_CHAR_WIDTH, YADVANCE, ST77XX_BLACK);
		tft.setCursor(MENU_START_VALUE_X, cY);
		tft.print("<");
	}
	if (lengthPotential > this->charDisplayStart + 6) {
		nullSearchBoundHigh = STRING_EDIT_VIEW_LENGTH - 2;
		tft.fillRect(MENU_START_VALUE_X + STRING_EDIT_CHAR_WIDTH * (STRING_EDIT_VIEW_LENGTH - 1), cY, STRING_EDIT_CHAR_WIDTH, YADVANCE, ST77XX_BLACK);
		tft.setCursor(MENU_START_VALUE_X + STRING_EDIT_CHAR_WIDTH * (STRING_EDIT_VIEW_LENGTH - 1), cY);
		tft.print(">");
	}
	uint8_t posX = MENU_START_VALUE_X + (this->charPos - this->charDisplayStart) * STRING_EDIT_CHAR_WIDTH;
	tft.setTextColor(ST77XX_WHITE);
	char c = ((char *)this->data)[this->charPos];
	if (c) {
		tft.setCursor(posX, cY);
		tft.print(c);
	} else {
#if HW_VERSION == 1
		tft.fillRect(posX + 1, cY + 2, 4, 4, tft.color565(255, 0, 0));
#elif HW_VERSION == 2
		tft.fillRect(posX + 2, cY + 2, 6, 6, tft.color565(255, 0, 0));
#endif
	}
	for (uint8_t i = nullSearchBoundLow; i <= nullSearchBoundHigh; i++) {
		char c = ((char *)this->data)[this->charDisplayStart + i];
		if (!c) {
			if (this->charPos == this->charDisplayStart + i)
				break;
#if HW_VERSION == 1
			tft.fillRect(MENU_START_VALUE_X + i * STRING_EDIT_CHAR_WIDTH + 2, cY + 3, 2, 2, tft.color565(150, 0, 0));
#elif HW_VERSION == 2
			tft.fillRect(MENU_START_VALUE_X + i * STRING_EDIT_CHAR_WIDTH + 3, cY + 3, 4, 4, tft.color565(150, 0, 0));
#endif
			break;
		}
	}
}

void MenuItem::drawValueNotEntered(const int16_t cY) {
	if (this->itemType != MenuItemType::VARIABLE) return;
	switch (varType) {
	case VariableType::BOOL: {
		this->drawBoolValue(cY, ST77XX_BLACK, ST77XX_WHITE, redrawValue || lastEntryDrawType == DRAW_ENTERED);
	} break;
	case VariableType::uint8_t_LUT: {
		this->drawLutValue(cY, ST77XX_BLACK, ST77XX_WHITE, redrawValue || lastEntryDrawType == DRAW_ENTERED);
	} break;
	case VariableType::STRING: {
		this->drawStringValue(cY, ST77XX_BLACK, ST77XX_WHITE, redrawValue || lastEntryDrawType == DRAW_ENTERED);
	} break;
	default: {
		this->drawNumberValue(cY, ST77XX_BLACK, ST77XX_WHITE, redrawValue || lastEntryDrawType == DRAW_ENTERED);
	} break;
	}
}
void MenuItem::drawValueEntered(const int16_t cY) {
	if (this->itemType != MenuItemType::VARIABLE) return;
	switch (varType) {
	case VariableType::BOOL: {
		this->drawBoolValue(cY, ST77XX_WHITE, ST77XX_BLACK, true);
	} break;
	case VariableType::uint8_t_LUT: {
		this->drawLutValue(cY, ST77XX_WHITE, ST77XX_BLACK, true);
	} break;
	case VariableType::STRING: {
		this->drawEditableString(cY);
	} break;
	default: {
		this->drawNumberValue(cY, ST77XX_WHITE, ST77XX_BLACK, true);
	} break;
	}
}

void MenuItem::drawEntry(bool fullRedraw) {
	if (!this->visible) return;
	const int16_t cY = tft.getCursorY();
	if (cY >= SCREEN_HEIGHT) return;

	// Draw profile / standard color indicator
	uint16_t thisColor = this->isProfileDependent ? profileColor565 : ST77XX_WHITE;
	if ((this->lastProfileColor565 != thisColor || fullRedraw) && this->itemType == MenuItemType::VARIABLE) {
#if HW_VERSION == 1
		tft.fillRect(154, cY + 1, 6, 6, thisColor);
#elif HW_VERSION == 2
		tft.fillRect(234, cY + 3, 6, 6, thisColor);
#endif
		this->lastProfileColor565 = thisColor;
	}

	uint8_t thisDrawType = DRAW_UNFOCUSED;

	if (this->entered)
		thisDrawType = DRAW_ENTERED;
	else if (this->focused)
		thisDrawType = DRAW_FOCUSED;

	if (thisDrawType == DRAW_UNFOCUSED && lastEntryDrawType != DRAW_UNFOCUSED) {
		// remove arrow
#if HW_VERSION == 1
		tft.fillRect(0, cY, 6, YADVANCE, ST77XX_BLACK);
#elif HW_VERSION == 2
		tft.fillRect(0, cY, 8, YADVANCE, ST77XX_BLACK);
#endif
	}
	if (thisDrawType != DRAW_UNFOCUSED && (lastEntryDrawType == DRAW_UNFOCUSED || fullRedraw)) {
		// add arrow to show focus
		tft.setCursor(0, cY);
		tft.print('>');
	}
	if (thisDrawType != DRAW_ENTERED && (lastEntryDrawType == DRAW_ENTERED || redrawValue || fullRedraw)) {
		this->drawValueNotEntered(cY);
	}
	if (thisDrawType == DRAW_ENTERED && (lastEntryDrawType != DRAW_ENTERED || redrawValue || fullRedraw)) {
		this->drawValueEntered(cY);
	}

	if (fullRedraw) {
		switch (this->itemType) {
		case MenuItemType::INFO: {
			uint8_t usedLines = 0;
			printCentered(this->displayName, SCREEN_WIDTH / 2, cY, SCREEN_WIDTH, MAX_SCREEN_LINES, YADVANCE, ClipBehavior::PRINT_LAST_LINE_DOTS, &usedLines);
			this->entryHeight = usedLines * YADVANCE;
			tft.setCursor(0, cY + entryHeight);
			lastEntryDrawType = DRAW_UNFOCUSED;
			return;
		} break;
		default: {
			this->entryHeight = YADVANCE;
			// one-liner, draw the setting's name
			tft.setCursor(10, cY);
			tft.print(this->displayName);
		} break;
		}
	}
	lastEntryDrawType = thisDrawType;
	redrawValue = false;
	tft.setCursor(0, cY + entryHeight);
}

void MenuItem::save() {
	if (this->itemType == MenuItemType::VARIABLE && this->startEepromPos < EEPROM_SIZE) {
		uint32_t addr = this->startEepromPos;
		if (this->isProfileDependent) {
			addr += selectedProfile * PROFILE_EEPROM_SIZE;
		}
		switch (this->varType) {
		case VariableType::int32_t:
		case VariableType::uint32_t:
		case VariableType::FLOAT: {
			int32_t val = *(int32_t *)this->data;
			EEPROM.put(addr, val);
		} break;
		case VariableType::uint16_t:
		case VariableType::int16_t: {
			int16_t val = *(int16_t *)this->data;
			EEPROM.put(addr, val);
		} break;
		case VariableType::uint8_t:
		case VariableType::uint8_t_LUT:
		case VariableType::int8_t:
		case VariableType::BOOL: {
			int8_t val = *(int8_t *)this->data;
			EEPROM.put(addr, val);
		} break;
		case VariableType::STRING: {
			for (uint8_t i = 0; i < this->maxStringLength; i++) {
				char c = ((char *)this->data)[i];
				EEPROM.put(addr + i, c);
			}
		} break;
		}
	}
	for (uint8_t i = 0; i < this->children.size(); i++) {
		this->children[i]->save();
	}
}

bool MenuItem::isRebootRequired() {
	for (uint8_t i = 0; i < this->children.size(); i++) {
		if (this->children[i]->isRebootRequired()) return true;
	}
	return rebootRequired;
}

MenuItem *MenuItem::setOnEnterFunction(bool (*onEnterFunction)(MenuItem *i)) {
	this->onEnterFunction = onEnterFunction;
	return this;
}
MenuItem *MenuItem::setOnExitFunction(bool (*onExitFunction)(MenuItem *i)) {
	this->onExitFunction = onExitFunction;
	return this;
}
MenuItem *MenuItem::setCustomLoop(bool (*customLoop)(MenuItem *i)) {
	this->customLoop = customLoop;
	return this;
}
MenuItem *MenuItem::setOnUpFunction(bool (*onUpFunction)(MenuItem *i)) {
	this->onUpFunction = onUpFunction;
	return this;
}
MenuItem *MenuItem::setOnDownFunction(bool (*onDownFunction)(MenuItem *i)) {
	this->onDownFunction = onDownFunction;
	return this;
}
MenuItem *MenuItem::setOnLeftFunction(bool (*onLeftFunction)(MenuItem *i)) {
	this->onLeftFunction = onLeftFunction;
	return this;
}
MenuItem *MenuItem::setOnRightFunction(bool (*onRightFunction)(MenuItem *i)) {
	this->onRightFunction = onRightFunction;
	return this;
}
MenuItem *MenuItem::setCustomDrawFull(void (*customDrawFull)(MenuItem *i)) {
	this->customDrawFull = customDrawFull;
	return this;
}
MenuItem *MenuItem::setOnChangeFunction(void (*onChangeFunction)(MenuItem *i)) {
	this->onChangeFunction = onChangeFunction;
	return this;
}

void MenuItem::setRange(int32_t min, int32_t max) {
	setMin(min);
	setMax(max);
}
void MenuItem::setRange(float min, float max) {
	setMin(min);
	setMax(max);
}
void MenuItem::setMin(int32_t min) {
	this->minI = min;
	this->minF = min;
}
void MenuItem::setMin(float min) {
	this->minI = min;
	this->minF = min;
}
void MenuItem::setMax(int32_t max) {
	this->maxI = max;
	this->maxF = max;
}
void MenuItem::setMax(float max) {
	this->maxI = max;
	this->maxF = max;
}
void MenuItem::checkFocus() {
	if (this->itemType != MenuItemType::SUBMENU) return;
	// check if exactly one child has focus. If not, focus the first.
	uint8_t focusedCount = 0;
	for (uint8_t i = 0; i < this->children.size(); i++) {
		if ((!this->children[i]->visible || !this->children[i]->focusable) && this->children[i]->focused) {
			this->children[i]->focused = false;
		}
		if (this->children[i]->focused) {
			focusedCount++;
		}
	}
	if (focusedCount == 1) return;
	for (uint8_t i = 0; i < this->children.size(); i++) {
		if (this->children[i]->focusable && this->children[i]->visible) {
			this->children[i]->focused = true;
			this->children[i]->onFocus();
			return;
		}
	}
}

#if HW_VERSION == 1
void MenuItem::scheduleBeep(int16_t msSinceLast, uint8_t tone) {
	if (!settingsBeep) return;
	uint32_t settingsBeepAt = millis();
	if (msSinceLast <= 0 || msSinceLast < lastSettingsBeepTimer) {
		scheduledSettingsBeep = settingsBeepAt;
		scheduledBeepTone = tone;
		return;
	}
	settingsBeepAt += msSinceLast - lastSettingsBeepTimer;
	if (settingsBeepAt < scheduledSettingsBeep || !scheduledSettingsBeep) {
		scheduledSettingsBeep = settingsBeepAt;
		scheduledBeepTone = tone;
	}
}

void MenuItem::makeSettingsBeep(uint8_t tone) {
	lastSettingsBeepMotor++;
	lastSettingsBeepMotor %= 4;
	escCommandBuffer[lastSettingsBeepMotor].push(DSHOT_CMD_BEACON1 + tone);
	lastSettingsBeepTimer = 0;
}
#elif HW_VERSION == 2
void MenuItem::beep(uint16_t freq) {
	if (!settingsBeep) return;
	makeSound(freq, enteredRotationNavigation ? 25 : GESTURE_REPEAT_WAIT / 2);
}

uint16_t MenuItem::getValueBeepFreq() {
	if (this->itemType != MenuItemType::VARIABLE) return 0;
	if (!settingsBeep) return 0;
	switch (this->varType) {
	case VariableType::BOOL:
		return SETTINGS_BEEP_MIN_FREQ + ((*(bool *)this->data) != 0) * SETTINGS_BEEP_FREQ_RANGE;
	case VariableType::uint8_t_LUT:
		return SETTINGS_BEEP_MIN_FREQ + (*(uint8_t *)this->data) * SETTINGS_BEEP_FREQ_RANGE / this->maxI;
	case VariableType::uint8_t:
		return SETTINGS_BEEP_MIN_FREQ + ((*(uint8_t *)this->data) - this->minI) * SETTINGS_BEEP_FREQ_RANGE / (this->maxI - this->minI);
	case VariableType::int8_t:
		return SETTINGS_BEEP_MIN_FREQ + ((*(int8_t *)this->data) - this->minI) * SETTINGS_BEEP_FREQ_RANGE / (this->maxI - this->minI);
	case VariableType::uint16_t:
		return SETTINGS_BEEP_MIN_FREQ + ((*(uint16_t *)this->data) - this->minI) * SETTINGS_BEEP_FREQ_RANGE / (this->maxI - this->minI);
	case VariableType::int16_t:
		return SETTINGS_BEEP_MIN_FREQ + ((*(int16_t *)this->data) - this->minI) * SETTINGS_BEEP_FREQ_RANGE / (this->maxI - this->minI);
	case VariableType::uint32_t:
		return SETTINGS_BEEP_MIN_FREQ + ((*(uint32_t *)this->data) - this->minI) * SETTINGS_BEEP_FREQ_RANGE / (this->maxI - this->minI);
	case VariableType::int32_t:
		return SETTINGS_BEEP_MIN_FREQ + ((*(int32_t *)this->data) - this->minI) * SETTINGS_BEEP_FREQ_RANGE / (this->maxI - this->minI);
	case VariableType::FLOAT:
		return SETTINGS_BEEP_MIN_FREQ + ((*(float *)this->data) - this->minF) * SETTINGS_BEEP_FREQ_RANGE / (this->maxF - this->minF);
	default:
		return 0;
	}
	return 0;
}
#endif

void MenuItem::onExit() {
	DEBUG_PRINTF("Exiting %s\n", this->identifier);
	if (this->itemType != MenuItemType::VARIABLE) {
		if (this->parent != nullptr) {
			this->parent->triggerFullRedraw();
		}
	}
	if (this->onExitFunction != nullptr) {
		if (!this->onExitFunction(this)) return;
	}
	this->entered = false;
	this->focusTimer = 0;
	// clear last bytes to 0
	if (this->itemType == MenuItemType::VARIABLE && this->varType == VariableType::STRING)
		for (uint8_t i = strlen((char *)this->data); i < this->maxStringLength; i++)
			((char *)this->data)[i] = '\0';
	if (this->itemType == MenuItemType::SUBMENU) {
		for (uint8_t i = 0; i < this->children.size(); i++)
			this->children[i]->focused = false;
	}
}

void MenuItem::onUp() {
	if (this->onUpFunction != nullptr) {
		if (!this->onUpFunction(this)) return;
	}
#if HW_VERSION == 1
	scheduleBeep(SETTINGS_BEEP_PERIOD, 3);
#endif
	switch (this->itemType) {
	case MenuItemType::VARIABLE: {
		this->rebootRequired = this->rebootOnChange;
		switch (this->varType) {
		case VariableType::int32_t: {
			int32_t &val = *(int32_t *)this->data;
			int32_t pVal = val;
			val += this->stepSizeI;
			if (val > this->maxI || val < this->minI || (this->stepSizeI > 0 ? pVal > val : pVal < val)) {
				if (this->rollover) {
					if (this->stepSizeI > 0) {
						val = this->minI;
					} else {
						val = this->maxI;
					}
				} else {
					if (this->stepSizeI > 0) {
						val = this->maxI;
					} else {
						val = this->minI;
					}
				}
			}
#if HW_VERSION == 2
			beep(getValueBeepFreq());
#endif
		} break;
		case VariableType::uint32_t: {
			uint32_t &val = *(uint32_t *)this->data;
			uint32_t pVal = val;
			val += this->stepSizeI;
			if (val > this->maxI || val < this->minI || (this->stepSizeI > 0 ? pVal > val : pVal < val)) {
				if (this->rollover) {
					if (this->stepSizeI > 0) {
						val = this->minI;
					} else {
						val = this->maxI;
					}
				} else {
					if (this->stepSizeI > 0) {
						val = this->maxI;
					} else {
						val = this->minI;
					}
				}
			}
#if HW_VERSION == 2
			beep(getValueBeepFreq());
#endif
		} break;
		case VariableType::FLOAT: {
			float &val = *(float *)this->data;
			val += this->stepSizeF;
			if (val > this->maxF || val < this->minF) {
				if (this->rollover) {
					if (this->stepSizeF > 0) {
						val = this->minF;
					} else {
						val = this->maxF;
					}
				} else {
					if (this->stepSizeF > 0) {
						val = this->maxF;
					} else {
						val = this->minF;
					}
				}
			}
#if HW_VERSION == 2
			beep(getValueBeepFreq());
#endif
		} break;
		case VariableType::uint16_t: {
			uint16_t &val = *(uint16_t *)this->data;
			uint16_t pVal = val;
			val += this->stepSizeI;
			if (val > this->maxI || val < this->minI || (this->stepSizeI > 0 ? pVal > val : pVal < val)) {
				if (this->rollover) {
					if (this->stepSizeI > 0) {
						val = this->minI;
					} else {
						val = this->maxI;
					}
				} else {
					if (this->stepSizeI > 0) {
						val = this->maxI;
					} else {
						val = this->minI;
					}
				}
			}
#if HW_VERSION == 2
			beep(getValueBeepFreq());
#endif
		} break;
		case VariableType::int16_t: {
			int16_t &val = *(int16_t *)this->data;
			int16_t pVal = val;
			val += this->stepSizeI;
			if (val > this->maxI || val < this->minI || (this->stepSizeI > 0 ? pVal > val : pVal < val)) {
				if (this->rollover) {
					if (this->stepSizeI > 0) {
						val = this->minI;
					} else {
						val = this->maxI;
					}
				} else {
					if (this->stepSizeI > 0) {
						val = this->maxI;
					} else {
						val = this->minI;
					}
				}
			}
#if HW_VERSION == 2
			beep(getValueBeepFreq());
#endif
		} break;
		case VariableType::uint8_t:
		case VariableType::uint8_t_LUT: {
			uint8_t &val = *(uint8_t *)this->data;
			uint8_t pVal = val;
			val += this->stepSizeI;
			if (val > this->maxI || val < this->minI || (this->stepSizeI > 0 ? pVal > val : pVal < val)) {
				if (this->rollover) {
					if (this->stepSizeI > 0) {
						val = this->minI;
					} else {
						val = this->maxI;
					}
				} else {
					if (this->stepSizeI > 0) {
						val = this->maxI;
					} else {
						val = this->minI;
					}
				}
			}
#if HW_VERSION == 2
			beep(getValueBeepFreq());
#endif
		} break;
		case VariableType::int8_t: {
			int8_t &val = *(int8_t *)this->data;
			int8_t pVal = val;
			val += this->stepSizeI;
			if (val > this->maxI || val < this->minI || (this->stepSizeI > 0 ? pVal > val : pVal < val)) {
				if (this->rollover) {
					if (this->stepSizeI > 0) {
						val = this->minI;
					} else {
						val = this->maxI;
					}
				} else {
					if (this->stepSizeI > 0) {
						val = this->maxI;
					} else {
						val = this->minI;
					}
				}
			}
#if HW_VERSION == 2
			beep(getValueBeepFreq());
#endif
		} break;
		case VariableType::STRING: {
			char &c = ((char *)this->data)[charPos];
			switch (c) {
			case 'Z':
				c = 'a';
				break;
			case 'z':
				c = '.';
				break;
			case '.':
				c = ',';
				break;
			case ',':
				c = '-';
				break;
			case '-':
				c = '/';
				break;
			case '/':
				c = '+';
				break;
			case '+':
				c = '&';
				break;
			case '&':
				c = '!';
				break;
			case '!':
				c = '?';
				break;
			case '?':
				c = '#';
				break;
			case '#':
				c = '<';
				break;
			case '<':
				c = '>';
				break;
			case '>':
				c = '(';
				break;
			case '(':
				c = ')';
				break;
			case ')':
				c = '@';
				break;
			case '@':
				c = ' ';
				break;
			case ' ':
				c = '\0';
				break;
			case '\0':
				c = '0';
				break;
			case '9':
				c = 'A';
				break;
			default:
				c++;
			}
#if HW_VERSION == 2
			beep(SETTINGS_BEEP_MAX_FREQ);
#endif
		} break;
		}
		if (this->onChangeFunction != nullptr) {
			this->onChangeFunction(this);
		}
		this->redrawValue = true;
	} break;
	case MenuItemType::SUBMENU: {
		uint8_t size = this->children.size();
		for (uint8_t i = 0; i < size; i++) {
			if (this->children[i]->focused) {
				for (uint8_t j = i + size - 1; j != i; j--) {
					MenuItem *c = this->children[j % size];
					if (c->focusable && c->visible) {
						c->focused = true;
						c->onFocus();
						this->children[i]->focused = false;
						break;
					}
				}
				break;
			}
		}
#if HW_VERSION == 2
		beep(SETTINGS_BEEP_MAX_FREQ);
#endif
	} break;
#if HW_VERSION == 2
	default:
		beep(SETTINGS_BEEP_MAX_FREQ);
		break;
#endif
	}
}

void MenuItem::onDown() {
	if (this->onDownFunction != nullptr) {
		if (!this->onDownFunction(this)) return;
	}
#if HW_VERSION == 1
	scheduleBeep(SETTINGS_BEEP_PERIOD, 0);
#endif
	switch (this->itemType) {
	case MenuItemType::VARIABLE: {
		this->rebootRequired = this->rebootOnChange;
		switch (this->varType) {
		case VariableType::int32_t: {
			int32_t &val = *(int32_t *)this->data;
			int32_t pVal = val;
			val -= this->stepSizeI;
			if (val < this->minI || val > this->maxI || (this->stepSizeI > 0 ? pVal < val : pVal > val)) {
				if (this->rollover) {
					if (this->stepSizeI > 0) {
						val = this->maxI;
					} else {
						val = this->minI;
					}
				} else {
					if (this->stepSizeI > 0) {
						val = this->minI;
					} else {
						val = this->maxI;
					}
				}
			}
#if HW_VERSION == 2
			beep(getValueBeepFreq());
#endif
		} break;
		case VariableType::uint32_t: {
			uint32_t &val = *(uint32_t *)this->data;
			uint32_t pVal = val;
			val -= this->stepSizeI;
			if (val < this->minI || val > this->maxI || (this->stepSizeI > 0 ? pVal < val : pVal > val)) {
				if (this->rollover) {
					if (this->stepSizeI > 0) {
						val = this->maxI;
					} else {
						val = this->minI;
					}
				} else {
					if (this->stepSizeI > 0) {
						val = this->minI;
					} else {
						val = this->maxI;
					}
				}
			}
#if HW_VERSION == 2
			beep(getValueBeepFreq());
#endif
		} break;
		case VariableType::FLOAT: {
			float &val = *(float *)this->data;
			val -= this->stepSizeF;
			if (val < this->minF || val > this->maxF) {
				if (this->rollover) {
					if (this->stepSizeF > 0) {
						val = this->maxF;
					} else {
						val = this->minF;
					}
				} else {
					if (this->stepSizeF > 0) {
						val = this->minF;
					} else {
						val = this->maxF;
					}
				}
			}
#if HW_VERSION == 2
			beep(getValueBeepFreq());
#endif
		} break;
		case VariableType::uint16_t: {
			uint16_t &val = *(uint16_t *)this->data;
			val -= this->stepSizeI;
			if (val < this->minI || val > this->maxI) {
				if (this->rollover) {
					if (this->stepSizeI > 0) {
						val = this->maxI;
					} else {
						val = this->minI;
					}
				} else {
					if (this->stepSizeI > 0) {
						val = this->minI;
					} else {
						val = this->maxI;
					}
				}
			}
#if HW_VERSION == 2
			beep(getValueBeepFreq());
#endif
		} break;
		case VariableType::int16_t: {
			int16_t &val = *(int16_t *)this->data;
			int16_t pVal = val;
			val -= this->stepSizeI;
			if (val < this->minI || val > this->maxI || (this->stepSizeI > 0 ? pVal < val : pVal > val)) {
				if (this->rollover) {
					if (this->stepSizeI > 0) {
						val = this->maxI;
					} else {
						val = this->minI;
					}
				} else {
					if (this->stepSizeI > 0) {
						val = this->minI;
					} else {
						val = this->maxI;
					}
				}
			}
#if HW_VERSION == 2
			beep(getValueBeepFreq());
#endif
		} break;
		case VariableType::uint8_t:
		case VariableType::uint8_t_LUT: {
			uint8_t &val = *(uint8_t *)this->data;
			uint8_t pVal = val;
			val -= this->stepSizeI;
			if (val < this->minI || val > this->maxI || (this->stepSizeI > 0 ? pVal < val : pVal > val)) {
				if (this->rollover) {
					if (this->stepSizeI > 0) {
						val = this->maxI;
					} else {
						val = this->minI;
					}
				} else {
					if (this->stepSizeI > 0) {
						val = this->minI;
					} else {
						val = this->maxI;
					}
				}
			}
#if HW_VERSION == 2
			beep(getValueBeepFreq());
#endif
		} break;
		case VariableType::int8_t: {
			int8_t &val = *(int8_t *)this->data;
			int8_t pVal = val;
			val -= this->stepSizeI;
			if (val < this->minI || val > this->maxI || (this->stepSizeI > 0 ? pVal < val : pVal > val)) {
				if (this->rollover) {
					if (this->stepSizeI > 0) {
						val = this->maxI;
					} else {
						val = this->minI;
					}
				} else {
					if (this->stepSizeI > 0) {
						val = this->minI;
					} else {
						val = this->maxI;
					}
				}
			}
#if HW_VERSION == 2
			beep(getValueBeepFreq());
#endif
		} break;
		case VariableType::STRING: {
			char &c = ((char *)this->data)[charPos];
			switch (c) {
			case '.':
				c = 'z';
				break;
			case 'a':
				c = 'Z';
				break;
			case ',':
				c = '.';
				break;
			case '-':
				c = ',';
				break;
			case '/':
				c = '-';
				break;
			case '+':
				c = '/';
				break;
			case '&':
				c = '+';
				break;
			case '!':
				c = '&';
				break;
			case '?':
				c = '!';
				break;
			case '#':
				c = '?';
				break;
			case '<':
				c = '#';
				break;
			case '>':
				c = '<';
				break;
			case '(':
				c = '>';
				break;
			case ')':
				c = '(';
				break;
			case '@':
				c = ')';
				break;
			case ' ':
				c = '@';
				break;
			case '\0':
				c = ' ';
				break;
			case '0':
				c = '\0';
				break;
			case 'A':
				c = '9';
				break;
			default:
				c--;
			}
#if HW_VERSION == 2
			beep(SETTINGS_BEEP_MIN_FREQ);
#endif
		} break;
		}
		if (this->onChangeFunction != nullptr) {
			this->onChangeFunction(this);
		}
		this->redrawValue = true;
	} break;
	case MenuItemType::SUBMENU: {
		uint8_t size = this->children.size();
		for (uint8_t i = 0; i < size; i++) {
			if (this->children[i]->focused) {
				for (uint8_t j = i + 1; j != i + size; j++) {
					MenuItem *c = this->children[j % size];
					if (c->focusable && c->visible) {
						c->focused = true;
						c->onFocus();
						this->children[i]->focused = false;
						break;
					}
				}
				break;
			}
		}
#if HW_VERSION == 2
		beep(SETTINGS_BEEP_MIN_FREQ);
#endif
	} break;
#if HW_VERSION == 2
	default:
		beep(SETTINGS_BEEP_MIN_FREQ);
		break;
#endif
	}
}

void MenuItem::onLeft() {
	if (this->onLeftFunction != nullptr) {
		if (!this->onLeftFunction(this)) return;
	}
	if (this->itemType == MenuItemType::VARIABLE && this->varType == VariableType::STRING) redrawValue = true;
	if (this->itemType == MenuItemType::VARIABLE && this->varType == VariableType::STRING && this->charPos > 0) {
		this->charPos--;
#if HW_VERSION == 1
		scheduleBeep(0, 1);
#elif HW_VERSION == 2
		beep(SETTINGS_BEEP_MIN_FREQ + SETTINGS_BEEP_FREQ_RANGE / 3);
#endif
	} else if (lastGesture.type == GESTURE_PRESS) {
#if HW_VERSION == 1
		scheduleBeep(0, 1);
#elif HW_VERSION == 2
		beep(SETTINGS_BEEP_MIN_FREQ + SETTINGS_BEEP_FREQ_RANGE / 3);
#endif
		this->onExit();
	}
}

void MenuItem::onRight() {
	if (this->onRightFunction != nullptr) {
		if (!this->onRightFunction(this)) return;
	}
	switch (this->itemType) {
	case MenuItemType::VARIABLE:
		if (this->varType == VariableType::STRING) {
			redrawValue = true;
#if HW_VERSION == 1
			scheduleBeep(SETTINGS_BEEP_PERIOD, 1);
#elif HW_VERSION == 2
			beep(SETTINGS_BEEP_MIN_FREQ + SETTINGS_BEEP_FREQ_RANGE / 3);
#endif
		}
		if (this->varType == VariableType::STRING && this->charPos < strlen((char *)this->data) && this->charPos < this->maxStringLength - 2)
			this->charPos++;
		else
			this->charPos = 0;
		break;
	case MenuItemType::SUBMENU:
		if (lastGesture.type == GESTURE_PRESS) {
#if HW_VERSION == 1
			scheduleBeep(SETTINGS_BEEP_PERIOD, 1);
#elif HW_VERSION == 2
			beep(SETTINGS_BEEP_MIN_FREQ + SETTINGS_BEEP_FREQ_RANGE / 3);
#endif
			for (uint8_t i = 0; i < this->children.size(); i++) {
				if (this->children[i]->focused) {
					this->children[i]->onEnter();
					break;
				}
			}
		}
		break;
	default:
#if HW_VERSION == 1
		scheduleBeep(SETTINGS_BEEP_PERIOD, 1);
#elif HW_VERSION == 2
		beep(SETTINGS_BEEP_MIN_FREQ + SETTINGS_BEEP_FREQ_RANGE / 3);
#endif
	}
}

void MenuItem::drawFull() {
#if HW_VERSION == 2
	speakerLoopOnFastCore = true;
#endif
	if (this->customDrawFull != nullptr) {
		this->customDrawFull(this);
#if HW_VERSION == 2
		speakerLoopOnFastCore = false;
#endif
		return;
	}
	if (this->itemType != MenuItemType::SUBMENU) return;
	if (fullRedraw) tft.fillScreen(ST77XX_BLACK);
	tft.setCursor(0, -scrollTop);
	tft.setTextWrap(false);
	for (uint8_t i = 0; i < this->children.size(); i++) {
		this->children[i]->drawEntry(fullRedraw);
	}
	fullRedraw = false;
#if HW_VERSION == 2
	speakerLoopOnFastCore = false;
#endif
}