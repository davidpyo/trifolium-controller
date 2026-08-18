#include "hwDiag.h"
#include <Arduino.h>
#include <cmath> // sinf() - per-entity vertical motion
#include <Adafruit_SSD1306.h>
#include "../lib/Bounce2/src/Bounce2.h"
#include "deviceSettings.h"

extern Adafruit_SSD1306 display;      // owned by main.cpp
extern Bounce2::Button triggerSwitch; // owned by main.cpp / core0's loop()
extern Bounce2::Button menuButton;    // owned by menu.cpp
extern uint8_t triggerSwitchPin;      // owned by main.cpp
extern DeviceSettings deviceSettings; // owned by main.cpp

bool pinDefined(uint8_t pin); // defined in main.cpp
void handleSerialCommands();  // defined in main.cpp

static const int16_t OLED_WIDTH = 128;

// Fixed launch position, right edge, vertically centered on the display's active region.
static const int16_t ORIGIN_X = 123;
static const int16_t FIELD_TOP_Y = 14;    // just below the status row's hline
static const int16_t FIELD_BOTTOM_Y = 62; // uses the full remaining height
static const int16_t ORIGIN_Y = (FIELD_TOP_Y + FIELD_BOTTOM_Y) / 2;

// How close an entity's y has to be to ORIGIN_Y to be in the line of fire - matches the entity
// glyph's own vertical extent (drawEntity() draws roughly y-4 to y+3).
static const int16_t ALIGN_TOLERANCE_PX = 4;

static const uint8_t MAX_ENTITIES = 6;

struct Entity
{
    bool active = false;
    float x = 0;
    float y = 0;
    float t = 0; // local elapsed time, drives the sine below
    float phase = 0;
    float freq = 0; // radians per tick-second
    float amp = 0;  // vertical swing, centered on ORIGIN_Y
};

// Vertical position is a sine wave centered on ORIGIN_Y - guarantees each entity periodically
// sweeps back through the firing line regardless of phase/amplitude.
static void advanceEntity(Entity& entity, float dt)
{
    entity.t += dt;
    entity.y = ORIGIN_Y + entity.amp * sinf(entity.phase + entity.t * entity.freq);
}

// Reading only .isPressed() and deriving edges locally avoids racing core 0's own .update() calls.
struct FireEdge
{
    bool wasPressed = pinDefined(triggerSwitchPin) && triggerSwitch.isPressed();

    bool poll()
    {
        bool isPressed = pinDefined(triggerSwitchPin) && triggerSwitch.isPressed();
        bool edge = isPressed && !wasPressed;
        wasPressed = isPressed;
        return edge;
    }
};

static bool menuHeldToExit()
{
    static bool wasHeld = false;
    bool isHeld = menuButton.isPressed() &&
                  menuButton.currentDuration() >= deviceSettings.menuButtonHoldTime_ms;
    bool risingEdge = isHeld && !wasHeld;
    wasHeld = isHeld;
    return risingEdge;
}

static void drawOrigin()
{
    // A short barrel pointing left, attached to a slightly taller body/grip behind it.
    display.fillRect(ORIGIN_X - 6, ORIGIN_Y - 1, 6, 2, SSD1306_WHITE); // barrel
    display.fillRect(ORIGIN_X, ORIGIN_Y - 4, 5, 8, SSD1306_WHITE);     // body
}

static void drawEntity(int16_t x, int16_t y)
{
    // Rounded dome, scalloped skirt, two small dark eyes. Centered on (x, y), roughly 8px across.
    display.fillRoundRect(x - 4, y - 4, 8, 7, 2, SSD1306_WHITE);
    display.drawPixel(x - 3, y + 2, SSD1306_BLACK);
    display.drawPixel(x, y + 2, SSD1306_BLACK);
    display.drawPixel(x + 3, y + 2, SSD1306_BLACK);
    display.drawPixel(x - 2, y - 1, SSD1306_BLACK);
    display.drawPixel(x + 2, y - 1, SSD1306_BLACK);
}

// Dashed line from the origin to a resolved shot's endpoint - plots every few pixels along the
// line so it reads as a dotted tracer rather than a solid beam.
static void drawDottedShot(int16_t x0, int16_t y0, int16_t x1, int16_t y1)
{
    int16_t dx = x1 - x0, dy = y1 - y0;
    int16_t steps = max((int16_t)1, (int16_t)max((int16_t)abs(dx), (int16_t)abs(dy)));
    for (int16_t s = 0; s <= steps; s += 3)
    {
        float frac = (float)s / steps;
        display.drawPixel((int16_t)(x0 + dx * frac), (int16_t)(y0 + dy * frac), SSD1306_WHITE);
    }
}

void hwDiagFired()
{
    randomSeed(micros());

    Entity entities[MAX_ENTITIES];
    uint16_t score = 0;
    uint8_t lives = 3;

    unsigned long lastMoveTime = millis();
    unsigned long lastSpawnTime = millis();
    unsigned long sessionStart = millis();

    FireEdge fireEdge;
    bool sessionOver = false;

    // Shot tracer - persists for SHOT_VISIBLE_MS after firing so the dotted line is actually
    // visible for a moment instead of flashing for a single frame.
    bool shotActive = false;
    unsigned long shotStartTime = 0;
    int16_t shotTargetX = 0, shotTargetY = 0;
    static const unsigned long SHOT_VISIBLE_MS = 120;

    while (!sessionOver)
    {
        handleSerialCommands();
        menuButton.update();

        if (menuHeldToExit())
            return; // straight back to the menu, no further screen needed

        // Spawns get more frequent and horizontal speed increases with elapsed time, both floored.
        unsigned long elapsedMs = millis() - sessionStart;
        unsigned long spawnIntervalMs =
            max((unsigned long)450, (unsigned long)(1200 - elapsedMs / 40));
        float speedPxPerTick = min(2.0f, 0.8f + elapsedMs / 40000.0f);

        if (millis() - lastSpawnTime >= spawnIntervalMs)
        {
            lastSpawnTime = millis();
            for (uint8_t i = 0; i < MAX_ENTITIES; i++)
            {
                if (!entities[i].active)
                {
                    entities[i].active = true;
                    entities[i].x = 0;
                    entities[i].t = 0;
                    entities[i].phase = (float)random(0, 629) / 100.0f; // 0..2pi
                    entities[i].freq = (float)random(50, 151) / 100.0f; // 0.5..1.5 rad/tick-sec
                    entities[i].amp = (float)random(10, (FIELD_BOTTOM_Y - FIELD_TOP_Y) / 2 + 1);
                    break;
                }
            }
        }

        if (millis() - lastMoveTime >= 40)
        {
            lastMoveTime = millis();
            for (uint8_t i = 0; i < MAX_ENTITIES; i++)
            {
                if (!entities[i].active)
                    continue;
                entities[i].x += speedPxPerTick;
                advanceEntity(entities[i], 0.04f);
                if (entities[i].x >= ORIGIN_X)
                {
                    // Reached the origin unresolved - costs a life, not an instant end, so one
                    // missed entity doesn't end a run that's otherwise going well.
                    entities[i].active = false;
                    if (lives > 0)
                        lives--;
                    if (lives == 0)
                        sessionOver = true;
                }
            }
        }

        if (fireEdge.poll())
        {
            // Only resolves an entity within ALIGN_TOLERANCE_PX of ORIGIN_Y - real alignment
            // required, not free auto-aim.
            int8_t hit = -1;
            float hitX = -1;
            for (uint8_t i = 0; i < MAX_ENTITIES; i++)
            {
                if (!entities[i].active || fabsf(entities[i].y - ORIGIN_Y) > ALIGN_TOLERANCE_PX)
                    continue;
                if (entities[i].x > hitX)
                {
                    hitX = entities[i].x;
                    hit = (int8_t)i;
                }
            }

            shotActive = true;
            shotStartTime = millis();
            shotTargetY = ORIGIN_Y; // always straight - never diagonal, hit or miss
            if (hit >= 0)
            {
                shotTargetX = (int16_t)entities[hit].x;
                entities[hit].active = false;
                score++;
            }
            else
            {
                shotTargetX = 0; // missed - tracer goes all the way across, nothing to show for it
            }
        }

        display.clearDisplay();
        display.setTextSize(1);
        display.setTextColor(SSD1306_WHITE);
        display.setTextWrap(false);
        display.setCursor(0, 0);
        display.print("Score:" + String(score));
        String livesStr = "Lives:" + String(lives);
        display.setCursor(128 - (int16_t)livesStr.length() * 6, 0);
        display.print(livesStr);
        display.drawFastHLine(0, 10, OLED_WIDTH, 1);

        drawOrigin();
        for (uint8_t i = 0; i < MAX_ENTITIES; i++)
            if (entities[i].active)
                drawEntity((int16_t)entities[i].x, (int16_t)entities[i].y);

        if (shotActive)
        {
            if (millis() - shotStartTime < SHOT_VISIBLE_MS)
                drawDottedShot(ORIGIN_X, ORIGIN_Y, shotTargetX, shotTargetY);
            else
                shotActive = false;
        }

        display.display();

        delay(2);
    }

    display.clearDisplay();
    display.setTextSize(1);
    display.setTextColor(SSD1306_WHITE);
    display.setCursor(0, 20);
    display.println("GAME OVER");
    display.println("Final score: " + String(score));
    display.setCursor(0, 56);
    display.print("any press = back");
    display.display();

    bool wasPressed = menuButton.isPressed();
    while (true)
    {
        handleSerialCommands();
        menuButton.update();
        bool isPressed = menuButton.isPressed();
        if (!isPressed && wasPressed)
            break; // release after a short press - matches "any press" elsewhere
        wasPressed = isPressed;
        delay(10);
    }
}
