#pragma once
#include <Arduino.h>

// LittleFS-backed storage for an optional custom boot splash image, uploaded via the
// LOAD_SPLASH/CLEAR_SPLASH/DUMP_SPLASH Serial commands. Strict on purpose: must be exactly
// 128x64 1bpp, matching this display exactly - no scaling/cropping.
namespace SplashStore
{
constexpr size_t SPLASH_BYTES = 128 * 64 / 8; // 1024

bool loadCustomSplash(uint8_t* out);

// Stores exactly SPLASH_BYTES raw bytes as the new custom splash.
bool saveCustomSplash(const uint8_t* data);

// Removes the custom splash, reverting to the compiled-in default.
void clearCustomSplash();
} // namespace SplashStore
