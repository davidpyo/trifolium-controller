#include "serialLock.h"

#include <pico/critical_section.h>
#include <pico/mutex.h>

namespace
{
constexpr size_t kKeptBytes = 4096;

mutex_t lock;
volatile int holder = -1; // written only by the core holding the lock
int depth = 0;

// Filled by whichever core logs and emptied by whichever holds the lock, so guarded on its own.
critical_section_t keptGuard;
char kept[kKeptBytes];
size_t keptStart = 0;
size_t keptLen = 0;
uint32_t lostLines = 0;
} // namespace

namespace SerialLock
{
void begin()
{
    mutex_init(&lock);
    critical_section_init(&keptGuard);
}

void hold()
{
    const int core = (int)get_core_num();
    if (holder == core)
    {
        depth++;
        return;
    }
    mutex_enter_blocking(&lock);
    holder = core;
    depth = 1;
}

bool tryHold()
{
    const int core = (int)get_core_num();
    if (holder == core || !mutex_try_enter(&lock, nullptr))
        return false;
    holder = core;
    depth = 1;
    return true;
}

void release()
{
    if (--depth > 0)
        return;
    printKept();
    holder = -1;
    mutex_exit(&lock);
}

void printKept()
{
    char chunk[128];
    for (;;)
    {
        critical_section_enter_blocking(&keptGuard);
        const size_t n = keptLen < sizeof(chunk) ? keptLen : sizeof(chunk);
        for (size_t i = 0; i < n; i++)
            chunk[i] = kept[(keptStart + i) % kKeptBytes];
        keptStart = (keptStart + n) % kKeptBytes;
        keptLen -= n;
        const uint32_t lost = n == 0 ? lostLines : 0;
        if (n == 0)
            lostLines = 0;
        critical_section_exit(&keptGuard);

        if (n > 0)
        {
            Serial.write((const uint8_t*)chunk, n);
            continue;
        }
        if (lost > 0)
        {
            Serial.print(millis());
            Serial.print(" [WARN] ");
            Serial.print(lost);
            Serial.println(" log lines lost: the port was busy and the log buffer full");
        }
        return;
    }
}

void keep(const char* text, size_t len)
{
    critical_section_enter_blocking(&keptGuard);
    if (len > kKeptBytes - keptLen)
        lostLines++;
    else
    {
        for (size_t i = 0; i < len; i++)
            kept[(keptStart + keptLen + i) % kKeptBytes] = text[i];
        keptLen += len;
    }
    critical_section_exit(&keptGuard);
}
} // namespace SerialLock
