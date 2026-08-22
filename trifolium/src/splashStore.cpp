#include "splashStore.h"
#include <LittleFS.h>

namespace
{
const char* SPLASH_PATH = "/splash.bin";
}

namespace SplashStore
{
bool loadCustomSplash(uint8_t* out)
{
    File f = LittleFS.open(SPLASH_PATH, "r");
    if (!f)
        return false;
    bool ok = f.size() == SPLASH_BYTES && f.read(out, SPLASH_BYTES) == SPLASH_BYTES;
    f.close();
    return ok;
}

bool saveCustomSplash(const uint8_t* data)
{
    String tmpPath = String(SPLASH_PATH) + ".tmp";
    File f = LittleFS.open(tmpPath, "w");
    if (!f)
        return false;
    size_t written = f.write(data, SPLASH_BYTES);
    f.close();
    if (written != SPLASH_BYTES)
    {
        LittleFS.remove(tmpPath);
        return false;
    }

    // Temp-file-then-rename: same power-loss-safety reasoning as ProfileStore::saveProfile.
    LittleFS.remove(SPLASH_PATH);
    return LittleFS.rename(tmpPath, SPLASH_PATH);
}

void clearCustomSplash()
{
    LittleFS.remove(SPLASH_PATH);
}
} // namespace SplashStore
