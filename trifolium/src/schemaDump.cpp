#include "schemaDump.h"
#include "menuCore.h"
#include "deviceStore.h"
#include "profileStore.h"
#include "global.h"
#include "CONFIGURATION.h"
#include "firingModeBehavior.h"
#include "enumIds.h"
#include "pinConflicts.h"

// Written straight to Serial rather than built into an ArduinoJson document on purpose

// Whether this boot armed the device, not the stored flag - see main.cpp. The console branches
// on this before it renders anything, so it has to say what the device is doing now.
extern bool wiringLive;

extern MenuItem* rootItems[];
extern const uint8_t rootItemsCount;

namespace
{

const uint8_t kMaxDepth = 8;

void printJsonChar(char c)
{
    switch (c)
    {
    case '"':
        Serial.print("\\\"");
        break;
    case '\\':
        Serial.print("\\\\");
        break;
    case '\n':
        Serial.print("\\n");
        break;
    case '\r':
        Serial.print("\\r");
        break;
    case '\t':
        Serial.print("\\t");
        break;
    default:
        if ((uint8_t)c < 0x20)
            Serial.print(' '); // control characters can't appear in a valid label or name
        else
            Serial.print(c);
    }
}

void printJsonString(const char* text)
{
    Serial.print('"');
    for (const char* p = text; *p; p++)
        printJsonChar(*p);
    Serial.print('"');
}

void printJsonString(const String& text)
{
    Serial.print('"');
    for (uint16_t i = 0; i < text.length(); i++)
        printJsonChar(text.charAt(i));
    Serial.print('"');
}

// The const char* overload also removes a hazard: without it, printField("k", someCharPointer)
// would bind to the bool overload and emit `true` instead of the string.
void printField(const char* name, const char* value)
{
    Serial.print(',');
    printJsonString(name);
    Serial.print(':');
    printJsonString(value);
}

void printField(const char* name, const String& value)
{
    Serial.print(',');
    printJsonString(name);
    Serial.print(':');
    printJsonString(value);
}

// Emits a key with the fire-mode index filled in. The Select-Fire editor is one set of items shared
// by every mode, so the key they are declared with carries a `[*]` where the index belongs;
// emitItem() walks them once per mode, after selectContext(), so the index is known here.
void printKeyField(const char* key)
{
    if (!strstr(key, "[*]"))
    {
        printField("key", key);
        return;
    }
    String resolved(key);
    resolved.replace("[*]", "[" + String((int)fireModeEditorIndex()) + "]");
    printField("key", resolved);
}

void printField(const char* name, int64_t value)
{
    Serial.print(',');
    printJsonString(name);
    Serial.print(':');
    Serial.print((long long)value);
}

void printField(const char* name, bool value)
{
    Serial.print(',');
    printJsonString(name);
    Serial.print(value ? ":true" : ":false");
}

const char* kindName(ItemKind kind)
{
    switch (kind)
    {
    case ItemKind::Submenu:
        return "group";
    case ItemKind::Bool:
        return "bool";
    case ItemKind::Int:
        return "int";
    case ItemKind::Float:
        return "float";
    case ItemKind::Enum:
        return "enum";
    case ItemKind::Text:
        return "text";
    case ItemKind::Action:
    default:
        return "action";
    }
}

void emitItem(MenuItem* item, uint8_t depth);

void emitChildren(MenuItem* const* items, uint8_t count, uint8_t depth)
{
    Serial.print(",\"children\":[");
    bool first = true;
    for (uint8_t i = 0; i < count; i++)
    {
        if (!items[i])
            continue;
        if (!first)
            Serial.print(',');
        first = false;
        emitItem(items[i], depth);
    }
    Serial.print(']');
}

void emitItem(MenuItem* item, uint8_t depth)
{
    const ItemKind kind = item->kind();

    Serial.print("{\"label\":");
    printJsonString(item->label());
    printField("kind", kindName(kind));

    if (item->jsonKey())
        printKeyField(item->jsonKey());
    switch (item->storage())
    {
    case ItemStorage::Derived:
        printField("storage", "derived");
        break;
    case ItemStorage::Live:
        printField("storage", "live");
        break;
    case ItemStorage::Config:
        break; // the default, left implicit to keep the dump smaller
    }

    // Emitted rather than filtered
    if (!item->isVisible())
        printField("visible", false);

    // The rule behind `visible` above, so a console can re-evaluate as the user edits rather than
    // waiting for the next dump. Absent means do not re-evaluate.
    if (const VisibilityCondition* cond = item->visibleWhenData())
    {
        Serial.print(",\"visibleWhen\":[");
        for (uint8_t t = 0; t < cond->count; t++)
        {
            if (t)
                Serial.print(',');
            Serial.print("{\"key\":");
            printJsonString(cond->terms[t].key);
            Serial.print(",\"op\":\"");
            Serial.print(cond->terms[t].negate ? "ne" : "eq");
            Serial.print("\",\"value\":");
            printJsonString(cond->terms[t].value);
            Serial.print('}');
        }
        Serial.print(']');
    }
    if (!item->isEditable())
    {
        printField("editable", false);
        printField("locked", item->lockedMessage());
    }
    if (item->needsReboot())
        printField("reboot", true);
    if (!item->onDevice())
        printField("onDevice", false);
    if (item->displayHint())
        printField("display", item->displayHint());

    ItemBounds b;
    if (item->bounds(b))
    {
        printField("lo", b.lo);
        printField("hi", b.hi);
        printField("step", b.step);
        if (b.decimals)
            printField("decimals", (int64_t)b.decimals);
    }

    const uint8_t options = item->optionCount();
    if (options)
    {
        Serial.print(",\"options\":[");
        for (uint8_t i = 0; i < options; i++)
        {
            if (i)
                Serial.print(',');
            printJsonString(item->optionLabel(i));
        }
        Serial.print(']');

        // The stored value for each option, parallel to `options`. Config files carry these names,
        // not ordinals, so this is what a writer has to send - see enumIds.h.
        if (item->optionValue(0))
        {
            Serial.print(",\"optionValues\":[");
            for (uint8_t i = 0; i < options; i++)
            {
                if (i)
                    Serial.print(',');
                const char* id = item->optionValue(i);
                printJsonString(id ? id : "");
            }
            Serial.print(']');
        }
    }

    if (kind == ItemKind::Text)
    {
        // The item's own limits where it has them, and the on-device editor's otherwise. Only a
        // field a person types on the OLED is bound by that editor; boardId is written by a host.
        printField("maxLen", (int64_t)(item->textMaxLen() ? item->textMaxLen() : kTextEditLength));
        printField("charset", item->textCharset() ? item->textCharset() : kTextEditCharset);
    }

    const uint8_t childCount = item->childCount();
    if (childCount && depth + 1 < kMaxDepth)
    {
        // Lets a row that shares an editor with its siblings point that editor at itself first, so
        // the children below resolve against the right mode.
        item->selectContext();
        emitChildren(item->children(), childCount, depth + 1);
    }
    else if (childCount)
    {
        printField("truncated", true);
    }

    Serial.print('}');
}


void emitFireModeCapabilities()
{
    if (activeProfile.activeModeCount >= MAX_FIRE_MODES)
    {
        Serial.print(",\"fireModeCaps\":null");
        return;
    }

    const uint8_t scratch = activeProfile.activeModeCount;
    const uint8_t savedIndex = fireModeEditorIndex();
    const FireModeConfig savedScratch = activeProfile.fireModes[scratch];

    Serial.print(",\"fireModeCaps\":[");
    for (uint8_t mode = 0; mode < selectableBurstModeCount(); mode++)
    {
        if (mode)
            Serial.print(',');

        activeProfile.fireModes[scratch] = savedScratch;
        activeProfile.fireModes[scratch].burstMode = (burstFireType_t)mode;
        setFireModeEditorIndex(scratch);

        // The stored id, matching what each mode's burstMode row carries, so a reader can
        // correlate a mode with its capabilities without knowing the ordinal.
        Serial.print("{\"burstMode\":");
        printJsonString(enumIdOf(mode, kBurstModeIds, kBurstModeIdCount));
        printField("name", behaviorFor((burstFireType_t)mode).defaultName());
        Serial.print(",\"fields\":[");
        bool firstField = true;
        for (uint8_t i = 0; i < fireModeEditorFieldCount(); i++)
        {
            MenuItem* field = fireModeEditorField(i);
            if (!field || !field->jsonKey()) // Duplicate/Delete are actions, not fields
                continue;
            if (!firstField)
                Serial.print(',');
            firstField = false;
            // The row's declared key, placeholder and all: these describe what a burst mode allows
            // wherever it is used, so there is no mode index they belong to. Readers match on the leaf.
            Serial.print("{\"key\":");
            printJsonString(field->jsonKey());
            printField("visible", field->isVisible());
            ItemBounds b;
            if (field->bounds(b))
            {
                printField("lo", b.lo);
                printField("hi", b.hi);
                printField("step", b.step);
            }
            Serial.print('}');
        }
        Serial.print("]}");
    }
    Serial.print(']');

    activeProfile.fireModes[scratch] = savedScratch;
    setFireModeEditorIndex(savedIndex);
}

void clampSubtree(MenuItem* item, uint8_t depth)
{
    if (!item)
        return;

    if (item->isVisible())
        item->clampToBounds();

    const uint8_t childCount = item->childCount();
    if (!childCount || depth + 1 >= kMaxDepth)
        return;

    // A shortcut resolves to a subtree that is also reachable the long way, so clamping is
    // idempotent by design - every override either sets an in-range value or leaves it alone.
    item->selectContext();
    MenuItem* const* children = item->children();
    for (uint8_t i = 0; i < childCount; i++)
        clampSubtree(children[i], depth + 1);
}

} // namespace

void clampAllSettings()
{
    const uint8_t savedFireModeIndex = fireModeEditorIndex();

    for (uint8_t i = 0; i < rootItemsCount; i++)
        clampSubtree(rootItems[i], 0);

    setFireModeEditorIndex(savedFireModeIndex);
}

void dumpSchema()
{
    const uint8_t savedFireModeIndex = fireModeEditorIndex();

    Serial.print("{\"cmd\":\"DUMP_SCHEMA\"");
    printField("fw", String(MAJOR_VERSION) + "." + String(MINOR_VERSION) + "." +
                         String(PATCH_VERSION));
    // Provenance the device never interprets; the console holds the presets to match it against.
    printField("boardId", deviceSettings.boardId.c_str());
    // The console needs a flag to branch on before it renders anything else, and it must not be
    // "boardId is set": that string is unvalidated, so a preset naming a board would otherwise
    // read as a device that is ready to drive pins.
    printField("wiringConfigured", wiringLive);
    printField("deviceSchemaVersion", (int64_t)DeviceStore::CURRENT_SCHEMA_VERSION);
    printField("profileSchemaVersion", (int64_t)ProfileStore::CURRENT_SCHEMA_VERSION);
    printField("activeProfileIndex", (int64_t)activeProfileIndex);
    printField("profileCount", (int64_t)ProfileStore::MAX_PROFILE_COUNT);
    printField("maxFireModes", (int64_t)MAX_FIRE_MODES);
    printField("activeModeCount", (int64_t)activeProfile.activeModeCount);

    // Resolved once on core 0 before core 1 was released and never written since, so reading it
    // from here needs no lock - the same argument `board` rests on. Empty is the normal case.
    Serial.print(",\"pinConflicts\":");
    PinConflicts::writeJson(Serial);

    emitFireModeCapabilities();


    Serial.print(",\"tree\":[");
    for (uint8_t i = 0; i < rootItemsCount; i++)
    {
        if (i)
            Serial.print(',');
        emitItem(rootItems[i], 0);
    }
    Serial.print("]}");
    Serial.println();

    setFireModeEditorIndex(savedFireModeIndex);
}
