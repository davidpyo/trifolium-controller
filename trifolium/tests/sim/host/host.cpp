// trifolium-sim: one boot of the firmware on the fake board, driven by one JSON request per line on
// stdin and answered by one JSON reply per line on stdout.
//
// One process is one boot. A reboot stops the machine; the driver reads the flash and the RAM a
// reboot keeps back out of this process, then starts a fresh one on them, because nothing here can
// un-initialise the firmware's globals. sim/trifolium_sim/blaster.py is that driver, and the
// reference for what each request does.

#include "hal/hal.h"
#include "hal/machine.h"
#include "sim_flywheel.h"
#include "sim_panel.h"

#include <ArduinoJson.h>
#include <PIO_DShot.h>
#include <hardware/clocks.h>

#include "batteryMonitor.h"
#include "deviceSettings.h"
#include "deviceStore.h"
#include "enumIds.h"
#include "flywheelMotor.h"
#include "global.h"
#include "menu.h"
#include "pinConflicts.h"
#include "shotProfile.h"
#include "types.h"

#include <cstring>
#include <iostream>
#include <string>
#include <vector>

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

extern DeviceSettings deviceSettings;
extern ShotProfile activeProfile;
extern uint8_t activeProfileIndex;
extern volatile bool bootSettingsLoaded;
extern bool showRuntimeInfo;
extern bool wiringLive;
extern bool motorsEnabled[4];
extern FlywheelMotor motorArr[4];
extern flywheelState_t flywheelState;
extern int8_t firingMode;
extern int16_t shotsToFire;
extern uint32_t runtimeShotCounter;
extern bool idleHoldActive;
extern bool safetyEngaged;
extern burstFireType_t burstMode;
extern bool requestRev;
extern float rpmScale_;
extern float liveTargetDPS;
extern uint32_t triggerTime_ms;
extern bool pusherValid;
extern bool displayAllowed;
extern bool revSafetyLatched;
extern bool firing;
extern BatteryMonitor* batteryMonitor;
extern uint8_t menuButtonPin, triggerSwitchPin, revSwitchPin, cycleSwitchPin, dartSwitchPin,
    idleSwitchPin, safetySwitchPin, ledDataPin, batteryAdcPin, speedPotPin, escEnablePin;
extern uint8_t selectPins[3];
extern bool dartPresent, breechEmptiedSincePush;
extern uint32_t dartWaitSince_ms;
extern uint8_t pusherPin();
bool menuIsOpen();

namespace
{
// ---- bytes on the wire -----------------------------------------------------------------------

const char kB64[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

std::string b64encode(const std::string& in)
{
    std::string out;
    size_t i = 0;
    for (; i + 2 < in.size(); i += 3)
    {
        const uint32_t n = ((uint8_t)in[i] << 16) | ((uint8_t)in[i + 1] << 8) | (uint8_t)in[i + 2];
        out += kB64[(n >> 18) & 63];
        out += kB64[(n >> 12) & 63];
        out += kB64[(n >> 6) & 63];
        out += kB64[n & 63];
    }
    if (i < in.size())
    {
        uint32_t n = (uint8_t)in[i] << 16;
        if (i + 1 < in.size())
            n |= (uint8_t)in[i + 1] << 8;
        out += kB64[(n >> 18) & 63];
        out += kB64[(n >> 12) & 63];
        out += i + 1 < in.size() ? kB64[(n >> 6) & 63] : '=';
        out += '=';
    }
    return out;
}

std::string b64decode(const std::string& in)
{
    std::string out;
    uint32_t n = 0;
    int bits = 0;
    for (char c : in)
    {
        const char* at = std::strchr(kB64, c);
        if (!at || c == '\0')
            continue; // padding and anything else
        n = (n << 6) | (uint32_t)(at - kB64);
        bits += 6;
        if (bits >= 8)
        {
            bits -= 8;
            out += (char)((n >> bits) & 0xFF);
        }
    }
    return out;
}

// A request's bytes: "b64" if it has them, "text" otherwise.
std::string bytesOf(JsonObjectConst req)
{
    if (const char* b = req["b64"])
        return b64decode(b);
    return req["text"] | "";
}

struct Error : std::runtime_error
{
    using std::runtime_error::runtime_error;
};

const char* stopName(hal::Stop s)
{
    switch (s)
    {
    case hal::Stop::None: return "none";
    case hal::Stop::Reboot: return "reboot";
    case hal::Stop::RebootToBootloader: return "bootloader";
    case hal::Stop::Panic: return "panic";
    case hal::Stop::PowerLoss: return "powerloss";
    case hal::Stop::Exception: return "exception";
    }
    return "none";
}

const char* modeName(PinMode m)
{
    switch (m)
    {
    case INPUT: return "input";
    case OUTPUT: return "output";
    case INPUT_PULLUP: return "input_pullup";
    case INPUT_PULLDOWN: return "input_pulldown";
    case OUTPUT_OPENDRAIN: return "output_opendrain";
    default: return "output_drive";
    }
}

// ---- the host --------------------------------------------------------------------------------

class Host
{
  public:
    Host()
    {
        hal::resetWorld();
        hal::powerOn();
        setPack(16400);
        hal::setWriteHook([this](uint8_t pin, bool level) { onWrite(pin, level); });
        hal::setInputHook([this](uint8_t pin) { return dartSwitchLevel(pin); });
        BidirDShotX1::onCreate = [this](BidirDShotX1& esc)
        {
            for (int i = 0; i < 4; i++)
            {
                if (motorsEnabled[i] && deviceSettings.escPins[i] == esc.escPin())
                    wheels_[i].attach(esc);
            }
            if (wiringLive && deviceSettings.pusherDrive == PUSHER_DRIVE_ESC &&
                esc.escPin() == pusherPin())
                esc.onFrame = [this](BidirDShotX1& e) { onPusherEscFrame(e); };
        };
    }

    ~Host()
    {
        machine_.halt();
        hal::setWriteHook(nullptr);
        hal::setInputHook(nullptr);
        BidirDShotX1::onCreate = nullptr;
    }

    // False once the driver has said goodbye.
    bool handle(JsonObjectConst req, JsonObject out)
    {
        const std::string op = req["op"] | "";
        out["ok"] = true;

        if (op == "hello")
        {
            out["protocol"] = 1;
            out["fw"] = String(MAJOR_VERSION) + "." + String(MINOR_VERSION) + "." + String(PATCH_VERSION);
        }
        else if (op == "quit")
        {
            machine_.halt();
            return false;
        }

        // ---- the world outside the chip
        else if (op == "pin.drive")
            hal::drive(req["pin"], req["level"] | false);
        else if (op == "pin.release")
            hal::release(req["pin"]);
        else if (op == "switch")
            setSwitch(req["role"] | "", req["pressed"] | false, out);
        else if (op == "analog")
            hal::setAnalog(req["pin"], req["raw"]);
        else if (op == "pot")
            setPot(req["fraction"] | 1.0f, out);
        else if (op == "pack")
        {
            setPack(req["mv"]);
            hal::setAnalogRise((uint64_t)(req["riseMs"] | 0) * 1000,
                               (uint64_t)(req["chargedMs"] | 0) * 1000);
        }
        else if (op == "i2c.device")
            hal::setI2cDevice(req["address"], req["present"] | true);
        else if (op == "panel.attach")
        {
            hal::setI2cDevice(0x3C, true);
            panel_.mountedUpsideDown = req["upsideDown"] | true;
            panel_.attach(0x3C);
        }
        else if (op == "host.connected")
            hal::setHostConnected(req["value"] | true);
        else if (op == "passthrough")
        {
            hal::passthrough().ticksLeft = req["ticks"] | 0;
            hal::passthrough().restoreFails = req["restoreFails"] | false;
        }
        else if (op == "passthrough.state")
        {
            const hal::Passthrough& pt = hal::passthrough();
            out["active"] = pt.active;
            out["sessions"] = pt.sessions;
            out["ticksLeft"] = pt.ticksLeft;
            out["clockDuring_hz"] = pt.clockDuring_hz;
            out["clock_hz"] = clock_get_hz(clk_sys);
            JsonArray pins = out["pins"].to<JsonArray>();
            for (uint8_t p : pt.pins)
                pins.add(p);
        }
        else if (op == "tick")
            hal::setTickPerRead_us(req["us"]);
        else if (op == "wheel")
            configureWheel(req);
        else if (op == "esc.startup")
        {
            for (int i = 0; i < 4; i++)
            {
                wheels_[i].startupModelled = true;
                wheels_[i].startup_ms = req["ms"][i] | 0;
                wheels_[i].restart_ms = req["restartMs"] | 0;
                wheels_[i].restarted = req["restarted"] | false;
            }
        }
        else if (op == "wheel.resetPeak")
            wheel(req["index"]).peakRpm = 0;
        else if (op == "esc.reply")
            overrideReply(req);
        else if (op == "darts")
        {
            dartsLoaded_ = req["loaded"] | dartsLoaded_;
            dartDelay_us_ = req["delay_us"] | dartDelay_us_;
            dartLoss_rpm_ = req["loss_rpm"] | dartLoss_rpm_;
        }
        else if (op == "magazine")
        {
            mag_.capacity = req["capacity"] | mag_.capacity;
            mag_.loadRate_dps = req["loadRate"] | mag_.loadRate_dps;
            mag_.leave_us = (uint32_t)(req["leaveMs"] | (int)(mag_.leave_us / 1000)) * 1000;
        }
        else if (op == "magazine.reload")
            reloadMagazine(hal::now_us());
        else if (op == "magazine.get")
            magazineState(out);
        else if (op == "magazine.set")
            restoreMagazine(req);
        else if (op == "magazine.byHand")
            mag_.byHand = req["value"] | true;

        // ---- flash
        else if (op == "flash.put")
            hal::flash().files[req["path"] | ""] = bytesOf(req);
        else if (op == "flash.get")
        {
            auto it = hal::flash().files.find(req["path"] | "");
            out["exists"] = it != hal::flash().files.end();
            if (it != hal::flash().files.end())
                out["b64"] = b64encode(it->second);
        }
        else if (op == "flash.del")
            hal::flash().files.erase(req["path"] | "");
        else if (op == "flash.dump")
        {
            JsonObject files = out["files"].to<JsonObject>();
            for (const auto& f : hal::flash().files)
                files[f.first] = b64encode(f.second);
        }
        else if (op == "flash.load")
        {
            hal::flash().files.clear();
            for (JsonPairConst kv : req["files"].as<JsonObjectConst>())
                hal::flash().files[kv.key().c_str()] = b64decode(kv.value().as<const char*>());
        }
        else if (op == "flash.cut")
            hal::flash().cutPowerBeforeWrite = hal::flash().writes + (req["write"] | 1);
        else if (op == "flash.stats")
        {
            out["writes"] = hal::flash().writes;
            out["committed"] = hal::flash().writesCommitted;
            out["mounted"] = hal::flash().mounted;
            out["formatted"] = hal::flash().formatted;
        }

        // ---- the RAM a reboot keeps
        else if (op == "noinit.set")
        {
            rebootReason = (BootReason)(req["rebootReason"] | 0);
            rebootPassthroughExit = (u8)(req["passthroughExit"] | (int)kNoBootButton);
            powerOnResetMagicNumber = std::stoull(req["magic"] | "0", nullptr, 16);
        }
        else if (op == "noinit.get")
            noinit(out);

        // ---- running
        else if (op == "boot")
        {
            if (started_)
                throw Error("already booted - one boot per process");
            started_ = true;
            setPack(packMv_); // the flash is final now, so which ADC pin is the pot's is known
            machine_.start();
            status(out);
        }
        else if (op == "run")
            run(req, out);
        else if (op == "status")
            status(out);
        else if (op == "halt")
            machine_.halt();

        // ---- looking at it
        else if (op == "serial.write")
            hal::serialWrite(bytesOf(req));
        else if (op == "serial.read")
        {
            // In pieces: ArduinoJson holds a string of at most 65535 characters, and base64 grows
            // a piece by a third.
            constexpr size_t kPiece = 32768;
            drainSerial();
            const size_t from = std::min<size_t>(req["from"] | 0, transcript_.size());
            const size_t end = std::min(transcript_.size(), from + kPiece);
            out["b64"] = b64encode(transcript_.substr(from, end - from));
            out["end"] = end;
            out["more"] = end < transcript_.size();
        }
        else if (op == "pins")
            pins(out);
        else if (op == "pin.edges")
        {
            const uint8_t pin = req["pin"];
            const uint64_t since = req["since_us"] | (uint64_t)0;
            JsonArray list = out["edges"].to<JsonArray>();
            if (pin < hal::kPinCount)
            {
                for (const Edge& e : edges_[pin])
                {
                    if (e.at_us < since)
                        continue;
                    JsonArray pair = list.add<JsonArray>();
                    pair.add(e.at_us);
                    pair.add(e.level);
                }
            }
        }
        else if (op == "pinModeCalls")
            out["count"] = hal::pinModeCalls();
        else if (op == "extends")
        {
            JsonArray list = out["at_us"].to<JsonArray>();
            for (uint64_t t : extends_)
                list.add(t);
        }
        else if (op == "wheels")
        {
            JsonArray list = out["wheels"].to<JsonArray>();
            for (int i = 0; i < 4; i++)
            {
                JsonObject w = list.add<JsonObject>();
                w["attached"] = wheels_[i].attached;
                w["rpm"] = wheels_[i].rpm;
                w["peak"] = wheels_[i].peakRpm;
                w["lastDartRpm"] = wheels_[i].lastDartRpm;
                w["throttle"] = wheels_[i].throttle;
                w["kv"] = wheels_[i].kv;
                w["polePairs"] = wheels_[i].polePairs;
                w["esc"] = !wheels_[i].powered                     ? "unpowered"
                           : wheels_[i].started(hal::now_us()) ? "up"
                                                                : "starting";
            }
        }
        else if (op == "escs")
            escs(out);
        else if (op == "heap")
        {
            const hal::Heap h = hal::heap();
            out["live"] = h.live;
            out["peak"] = h.peak;
            out["allocations"] = h.allocations;
            out["refused"] = h.refused;
            out["limit"] = h.limit;
            out["untracked"] = h.untracked;
        }
        else if (op == "heap.resetPeak")
            hal::resetHeapPeak();
        else if (op == "heap.limit")
            hal::setHeapLimit(req["bytes"] | (uint64_t)0);
        else if (op == "panel.read")
            readPanel(req, out);
        else if (op == "peek")
        {
            JsonObject values = out["values"].to<JsonObject>();
            for (JsonVariantConst name : req["names"].as<JsonArrayConst>())
                peek(name.as<const char*>(), values[name.as<const char*>()].to<JsonVariant>());
        }
        else if (op == "wiring")
        {
            JsonDocument doc;
            DeviceStore::toJson(wiring(), doc);
            out["settings"] = doc;
        }
        else if (op == "grid")
        {
            JsonArray results = out["results"].to<JsonArray>();
            for (JsonArrayConst c : req["cases"].as<JsonArrayConst>())
                results.add(steppedToGrid(c[0].as<int64_t>(), (int8_t)c[1].as<int>(),
                                          c[2].as<int64_t>(), c[3].as<int64_t>(),
                                          c[4].as<int64_t>(), c[5].as<bool>()));
        }
        else
            throw Error("unknown op '" + op + "'");
        return true;
    }

  private:
    struct Edge
    {
        uint64_t at_us;
        bool level;
    };

    hal::Machine machine_;
    bool started_ = false;
    int32_t packMv_ = 0; // what setPack() last gave
    SimFlywheel wheels_[4];
    sim::Panel panel_;
    bool dartsLoaded_ = true;
    uint32_t dartDelay_us_ = 15000;
    float dartLoss_rpm_ = 1700.0f;

    // A magazine feeding the breech. The spring puts the next dart in the breech once the pusher is
    // back, at the load rate; a push carries that dart past the dart switch and into the wheels,
    // and a push with the breech empty is dry. Not fitted until one is loaded - until then every
    // push launches a dart, as darts() says.
    struct Magazine
    {
        bool fitted = false;
        int capacity = 18;
        int darts = 0; // in the magazine, not the one in the breech
        float loadRate_dps = 100.0f;
        uint32_t leave_us = 4000; // from the push to the dart clearing the switch
        bool breech = false;
        bool pusherOut = false;
        uint64_t leavesAt_us = 0; // a pushed dart still on the switch until then
        uint64_t feedsAt_us = 0;  // the spring has the next dart there then
        uint32_t launched = 0;
        uint32_t dry = 0;
        bool byHand = false; // a test is holding the dart switch itself, until the next reload
    } mag_;
    std::vector<uint64_t> extends_;
    std::vector<Edge> edges_[hal::kPinCount];
    std::string transcript_;

    SimFlywheel& wheel(int index)
    {
        if (index < 0 || index > 3)
            throw Error("wheel index is 0-3");
        return wheels_[index];
    }

    bool booted() const { return bootSettingsLoaded && (!wiringLive || showRuntimeInfo); }

    // The wiring a switch is on: the firmware's own copy once setup() has loaded it, and before
    // that what is on flash, read by the firmware's own parser - so a switch can be held through
    // power-on.
    DeviceSettings wiring() const
    {
        if (bootSettingsLoaded)
            return deviceSettings;
        DeviceSettings stored = DeviceStore::defaultDeviceSettings();
        auto it = hal::flash().files.find("/device.cfg");
        if (it != hal::flash().files.end())
        {
            JsonDocument doc;
            if (!deserializeJson(doc, it->second))
                DeviceStore::fromJson(doc, stored);
        }
        return stored;
    }

    void setSwitch(const std::string& role, bool pressed, JsonObject out)
    {
        const DeviceSettings w = wiring();
        uint8_t pin = PIN_NOT_USED;
        bool normallyClosed = false; // the select lines have no normally-closed option
        if (role == "menu") pin = w.menuButtonPin, normallyClosed = w.menuButtonNormallyClosed;
        else if (role == "trigger") pin = w.triggerSwitchPin, normallyClosed = w.triggerSwitchNormallyClosed;
        else if (role == "rev") pin = w.revSwitchPin, normallyClosed = w.revSwitchNormallyClosed;
        else if (role == "cycle") pin = w.cycleSwitchPin, normallyClosed = w.cycleSwitchNormallyClosed;
        else if (role == "dart") pin = w.dartSwitchPin, normallyClosed = w.dartSwitchNormallyClosed,
                                 mag_.byHand = true;
        else if (role == "idle") pin = w.idleSwitchPin, normallyClosed = w.idleSwitchNormallyClosed;
        else if (role == "safety") pin = w.safetySwitchPin, normallyClosed = w.safetySwitchNormallyClosed;
        else if (role == "select0") pin = w.select0Pin;
        else if (role == "select1") pin = w.select1Pin;
        else if (role == "select2") pin = w.select2Pin;
        else throw Error("no switch role '" + role + "'");
        if (pin == PIN_NOT_USED)
            throw Error("the " + role + " switch is not wired");

        // Every switch closes to ground; a normally-closed one opens when pressed.
        out["pin"] = pin;
        if (pressed != normallyClosed)
        {
            hal::drive(pin, LOW);
            out["level"] = false;
        }
        else
        {
            hal::release(pin);
            out["level"] = nullptr;
        }
    }

    // The speed pot turned `fraction` of the way from its grounded end, on the pin the wiring gives
    // it - the firmware's own copy once booted, the config on flash before that. With none wired
    // nothing reads it: it keeps its place, replayed onto each boot, for a wiring that has one.
    void setPot(float fraction, JsonObject out)
    {
        const uint8_t pin = wiring().speedPotPin;
        if (pin == PIN_NOT_USED)
        {
            out["pin"] = nullptr;
            return;
        }
        const float at = fraction < 0 ? 0 : fraction > 1 ? 1 : fraction;
        hal::setAnalog(pin, (int)(at * 1023.0f + 0.5f));
        out["pin"] = pin;
    }

    // BatteryMonitor: pack = adc_mv * 11, adc_mv = raw * 3300 / 1023. On every ADC pin but the
    // speed pot's, because before boot nothing has read which one the wiring uses. A pack reading
    // left on the pot's pin from before it was the pot's is cleared: a pot left alone reads 0.
    void setPack(int32_t mv)
    {
        packMv_ = mv;
        const int raw = (int)((mv / 11.0) * 1023.0 / 3300.0 + 0.5);
        const uint8_t pot = wiring().speedPotPin;
        for (uint8_t pin = 26; pin <= 29; pin++)
        {
            if (pin != pot)
                hal::setAnalog(pin, raw, true);
            else if (hal::analogRises(pin))
                hal::setAnalog(pin, 0);
        }
        for (SimFlywheel& w : wheels_)
        {
            w.packVoltage = mv / 1000.0f;
            w.setPowered(mv > 0);
        }
    }

    void configureWheel(JsonObjectConst req)
    {
        SimFlywheel& w = wheel(req["index"]);
        w.kv = req["kv"] | w.kv;
        w.loadedFraction = req["loaded"] | w.loadedFraction;
        w.tauUp_s = req["tauUp"] | w.tauUp_s;
        w.tauDown_s = req["tauDown"] | w.tauDown_s;
        w.startDelay_s = req["startDelay"] | w.startDelay_s;
        w.maxAccel_rpmPerS = req["maxAccel"] | w.maxAccel_rpmPerS;
        w.polePairs = req["poles"] | w.polePairs;
        w.replyEvery = req["replyEvery"] | w.replyEvery;
        w.replies = req["replies"] | w.replies;
    }

    void overrideReply(JsonObjectConst req)
    {
        SimFlywheel& w = wheel(req["index"]);
        if (!req["erpm"].isNull())
            w.overrideNext(SimFlywheel::Override::Erpm, req["erpm"]);
        else if (req["corrupt"] | false)
            w.overrideNext(SimFlywheel::Override::Corrupt);
        else
        {
            const std::string type = req["edt"] | "temperature";
            BidirDshotTelemetryType t = BidirDshotTelemetryType::TEMPERATURE;
            if (type == "voltage") t = BidirDshotTelemetryType::VOLTAGE;
            else if (type == "current") t = BidirDshotTelemetryType::CURRENT;
            else if (type == "stress") t = BidirDshotTelemetryType::STRESS;
            else if (type == "status") t = BidirDshotTelemetryType::STATUS;
            w.overrideNext(SimFlywheel::Override::Edt, req["value"] | 0, t);
        }
    }

    uint64_t feedInterval_us() const
    {
        return mag_.loadRate_dps > 0 ? (uint64_t)(1e6 / mag_.loadRate_dps) : UINT64_MAX / 2;
    }

    // The spring starts on the next dart once nothing is in its way: the breech empty, the last
    // dart off the switch and the pusher back.
    void feedFrom(uint64_t t)
    {
        if (mag_.fitted && !mag_.breech && !mag_.leavesAt_us && !mag_.feedsAt_us &&
            !mag_.pusherOut && mag_.darts > 0)
            mag_.feedsAt_us = t + feedInterval_us();
    }

    // What the magazine has done by `now`, applied lazily whenever anything asks.
    void settleMagazine(uint64_t now)
    {
        if (mag_.leavesAt_us && now >= mag_.leavesAt_us)
        {
            const uint64_t left = mag_.leavesAt_us;
            mag_.leavesAt_us = 0;
            mag_.breech = false;
            feedFrom(left);
        }
        if (mag_.feedsAt_us && now >= mag_.feedsAt_us)
        {
            mag_.feedsAt_us = 0;
            mag_.breech = true;
            mag_.darts--;
        }
    }

    void reloadMagazine(uint64_t now)
    {
        settleMagazine(now);
        mag_.fitted = true;
        mag_.byHand = false;
        mag_.darts = mag_.capacity;
        mag_.launched = mag_.dry = 0;
        feedFrom(now);
    }

    // True if the push carried a dart out of the breech.
    bool pushFromBreech(uint64_t now)
    {
        settleMagazine(now);
        mag_.pusherOut = true;
        mag_.feedsAt_us = 0; // the pusher is in the way of a dart on its way up
        if (!mag_.breech || mag_.leavesAt_us)
        {
            mag_.dry++;
            return false;
        }
        mag_.launched++;
        mag_.leavesAt_us = now + mag_.leave_us;
        return true;
    }

    void pusherBack(uint64_t now)
    {
        settleMagazine(now);
        mag_.pusherOut = false;
        feedFrom(now);
    }

    // The dart switch closes to ground on a dart, as setSwitch() presses it, unless it is one that
    // opens instead - and with no magazine in, the breech is empty. Only once the firmware has its
    // wiring, so no other pin is ever taken for the dart switch's.
    int dartSwitchLevel(uint8_t pin)
    {
        if (!wiringLive || mag_.byHand || pin != deviceSettings.dartSwitchPin)
            return -1;
        settleMagazine(hal::now_us());
        const bool dart = mag_.fitted && mag_.breech;
        return dart != deviceSettings.dartSwitchNormallyClosed ? 0 : -1;
    }

    // Pending times go out as what is left of them, since each boot's clock starts again at 0.
    void magazineState(JsonObject out)
    {
        const uint64_t now = hal::now_us();
        settleMagazine(now);
        out["fitted"] = mag_.fitted;
        out["capacity"] = mag_.capacity;
        out["darts"] = mag_.darts;
        out["loadRate"] = mag_.loadRate_dps;
        out["leaveMs"] = mag_.leave_us / 1000;
        out["breech"] = mag_.breech;
        out["launched"] = mag_.launched;
        out["dry"] = mag_.dry;
        out["leavesInUs"] = mag_.leavesAt_us ? mag_.leavesAt_us - now : 0;
        out["feedsInUs"] = mag_.feedsAt_us ? mag_.feedsAt_us - now : 0;
    }

    void restoreMagazine(JsonObjectConst req)
    {
        const uint64_t now = hal::now_us();
        mag_.fitted = req["fitted"] | false;
        mag_.capacity = req["capacity"] | mag_.capacity;
        mag_.darts = req["darts"] | 0;
        mag_.loadRate_dps = req["loadRate"] | mag_.loadRate_dps;
        mag_.leave_us = (uint32_t)(req["leaveMs"] | 4) * 1000;
        mag_.breech = req["breech"] | false;
        mag_.launched = req["launched"] | 0u;
        mag_.dry = req["dry"] | 0u;
        const uint64_t leavesIn = req["leavesInUs"] | (uint64_t)0;
        const uint64_t feedsIn = req["feedsInUs"] | (uint64_t)0;
        mag_.leavesAt_us = leavesIn ? now + leavesIn : 0;
        mag_.feedsAt_us = feedsIn ? now + feedsIn : 0;
        mag_.pusherOut = false; // a reboot drops the gate
        feedFrom(now);
    }

    void onWrite(uint8_t pin, bool level)
    {
        const bool changed =
            pin < hal::kPinCount && (edges_[pin].empty() || edges_[pin].back().level != level);
        if (changed)
            edges_[pin].push_back({hal::now_us(), level});

        if (wiringLive && deviceSettings.pusherDrive == PUSHER_DRIVE_FET && pin == pusherPin())
            onPusher(level, changed);
    }

    // An ESC-driven pusher is a brushed motor in place of a solenoid: out while its channel is
    // sent any throttle, back the moment it is sent none. Its pushes are kept as edges on the
    // channel's pin, the way a FET's gate is, so edges() and the panel read either the same way.
    void onPusherEscFrame(BidirDShotX1& esc)
    {
        const bool out = esc.lastThrottle != 0;
        std::vector<Edge>& edges = edges_[esc.escPin()];
        if (!edges.empty() ? edges.back().level == out : !out)
            return;
        edges.push_back({hal::now_us(), out});
        onPusher(out, true);
    }

    // The pusher going out or coming back, whatever drives it.
    void onPusher(bool out, bool changed)
    {
        if (!out)
        {
            if (changed && mag_.fitted)
                pusherBack(hal::now_us());
            return;
        }
        extends_.push_back(hal::now_us());
        if (mag_.fitted ? !(changed && pushFromBreech(hal::now_us())) : !dartsLoaded_)
            return;
        for (SimFlywheel& w : wheels_)
        {
            if (w.attached)
                w.hitAt(hal::now_us() + dartDelay_us_, dartLoss_rpm_);
        }
    }

    void drainSerial() { transcript_ += hal::serialRead(); }

    void noinit(JsonObject out)
    {
        char magic[17];
        std::snprintf(magic, sizeof(magic), "%016llx", (unsigned long long)powerOnResetMagicNumber);
        out["rebootReason"] = (int)rebootReason;
        out["passthroughExit"] = (int)rebootPassthroughExit;
        out["magic"] = magic;
    }

    void status(JsonObject out)
    {
        out["now_us"] = hal::now_us();
        out["booted"] = started_ && booted();
        out["stopped"] = machine_.stopped();
        out["stop"] = stopName(machine_.stop());
        out["detail"] = machine_.stopDetail();
        noinit(out["noinit"].to<JsonObject>());
    }

    bool met(JsonObjectConst until, size_t serialFrom)
    {
        if (until["booted"] | false)
            return booted();
        if (until["stopped"] | false)
            return machine_.stopped();
        if (const char* text = until["serial"])
        {
            drainSerial();
            return transcript_.find(text, serialFrom) != std::string::npos;
        }
        if (const char* text = until["panel"])
            return panel_.shows(text);
        if (const char* name = until["peek"])
        {
            JsonDocument v;
            peek(name, v.to<JsonVariant>());
            const std::string cmp = until["op"] | "eq";
            JsonVariantConst want = until["value"];
            if (v.is<bool>() || want.is<bool>())
                return (v.as<bool>() == want.as<bool>()) == (cmp != "ne");
            const double a = v.as<double>(), b = want.as<double>();
            if (cmp == "eq") return a == b;
            if (cmp == "ne") return a != b;
            if (cmp == "ge") return a >= b;
            if (cmp == "gt") return a > b;
            if (cmp == "le") return a <= b;
            if (cmp == "lt") return a < b;
            throw Error("unknown comparison '" + cmp + "'");
        }
        throw Error("unknown condition in 'until'");
    }

    void run(JsonObjectConst req, JsonObject out)
    {
        if (!started_)
            throw Error("not booted");
        const uint64_t us = req["us"] | 0;
        JsonObjectConst until = req["until"];
        bool hit = false;
        if (until.isNull())
        {
            machine_.run_us(us);
        }
        else
        {
            const uint64_t step = req["step_us"] | 1000;
            drainSerial();
            const size_t serialFrom = until["from"] | transcript_.size();
            for (uint64_t t = 0;; t += step)
            {
                if ((hit = met(until, serialFrom)))
                    break;
                if (t >= us || !machine_.run_us(std::min(step, us - t)))
                {
                    hit = met(until, serialFrom);
                    break;
                }
            }
        }
        status(out);
        out["met"] = hit;
    }

    void pins(JsonObject out)
    {
        JsonArray list = out["pins"].to<JsonArray>();
        for (uint8_t n = 0; n < hal::kPinCount; n++)
        {
            JsonObject p = list.add<JsonObject>();
            p["n"] = n;
            p["modeSet"] = hal::modeSet(n);
            if (hal::modeSet(n))
                p["mode"] = modeName(hal::mode(n));
            p["output"] = hal::isOutput(n);
            p["outputLevel"] = hal::outputLevel(n);
            p["level"] = hal::level(n);
            p["fn"] = (int)gpio_get_function(n);
        }
    }

    void escs(JsonObject out)
    {
        JsonArray list = out["escs"].to<JsonArray>();
        for (BidirDShotX1* esc : BidirDShotX1::instances)
        {
            JsonObject e = list.add<JsonObject>();
            e["pin"] = esc->escPin();
            e["speed"] = esc->speed();
            e["lastThrottle"] = esc->lastThrottle;
            e["frames"] = esc->frameCount;
            e["throttleFrames"] = esc->throttleFrameCount;
            e["framesCut"] = esc->framesCut;
            e["repliesAborted"] = esc->repliesAborted;
            e["repliesFifoFull"] = esc->repliesFifoFull;
            JsonArray cmds = e["commands"].to<JsonArray>();
            for (uint16_t c : esc->commands)
                cmds.add(c);
        }
    }

    void readPanel(JsonObjectConst req, JsonObject out)
    {
        out["attached"] = hal::i2cDevicePresent(0x3C);
        out["on"] = panel_.on();
        out["contrast"] = panel_.contrast();
        out["inverted"] = panel_.inverted();
        out["dataBytes"] = panel_.dataBytes();
        out["highlighted"] = panel_.highlighted();
        JsonArray lines = out["lines"].to<JsonArray>();
        for (const sim::Panel::Line& l : panel_.lines())
        {
            JsonObject line = lines.add<JsonObject>();
            line["x"] = l.x;
            line["y"] = l.y;
            line["text"] = l.text;
            line["highlighted"] = l.highlighted;
        }
        if (req["pixels"] | false)
        {
            std::string rows;
            for (int y = 0; y < sim::Panel::kHeight; y++)
            {
                for (int x = 0; x < sim::Panel::kWidth; x++)
                    rows += panel_.pixel(x, y) ? '1' : '0';
                rows += '\n';
            }
            out["pixels"] = rows;
        }
    }

    // Firmware state the serial protocol does not publish, read directly. Deliberately a list of
    // names rather than arbitrary memory, so a test says what it depends on.
    void peek(const std::string& name, JsonVariant v)
    {
        if (name == "flywheelState") v.set((int)flywheelState);
        else if (name == "firingMode") v.set(firingMode);
        else if (name == "shotsToFire") v.set(shotsToFire);
        else if (name == "runtimeShotCounter") v.set(runtimeShotCounter);
        else if (name == "idleHoldActive") v.set(idleHoldActive);
        else if (name == "safetyEngaged") v.set(safetyEngaged);
        else if (name == "wiringLive") v.set(wiringLive);
        else if (name == "bootSettingsLoaded") v.set((bool)bootSettingsLoaded);
        else if (name == "showRuntimeInfo") v.set(showRuntimeInfo);
        else if (name == "booted") v.set(started_ && booted());
        else if (name == "menuOpen") v.set(menuIsOpen());
        else if (name == "burstMode") v.set((int)burstMode);
        else if (name == "burstModeId")
            v.set(burstMode < kBurstModeIdCount ? kBurstModeIds[burstMode] : "?");
        else if (name == "bootReason") v.set((int)bootReason);
        else if (name == "requestRev") v.set(requestRev);
        else if (name == "rpmScale") v.set(rpmScale_);
        else if (name == "dart")
        {
            v["present"] = dartPresent;
            v["emptiedSincePush"] = breechEmptiedSincePush;
            if (dartWaitSince_ms == 0)
                v["waitMs"] = nullptr;
            else
                v["waitMs"] = millis() - dartWaitSince_ms;
        }
        else if (name == "liveTargetDPS") v.set(liveTargetDPS);
        else if (name == "triggerTime_ms") v.set(triggerTime_ms);
        else if (name == "pusherValid") v.set(pusherValid);
        else if (name == "displayAllowed") v.set(displayAllowed);
        else if (name == "revSafetyLatched") v.set(revSafetyLatched);
        else if (name == "firing") v.set(firing);
        else if (name == "activeProfileIndex") v.set(activeProfileIndex);
        else if (name == "battery")
        {
            v["defined"] = batteryMonitor && batteryMonitor->isDefined();
            v["mv"] = batteryMonitor ? batteryMonitor->getVoltage_mv() : 0;
        }
        else if (name == "motors")
        {
            for (int i = 0; i < 4; i++)
            {
                const FlywheelMotor& m = motorArr[i];
                JsonObject o = v.add<JsonObject>();
                o["enabled"] = motorsEnabled[i];
                o["revRPM"] = m.revRPM;
                o["targetRPM"] = m.targetRPM;
                o["motorRPM"] = m.motorRPM;
                o["PIDOutput"] = m.PIDOutput;
                o["PIDIntegral"] = m.PIDIntegral;
                o["iTerm"] = m.iTerm;
                o["firstCrossing"] = m.firstCrossing;
                o["erpmSeen"] = m.telemetryErpmSeen;
                o["tempSeen"] = m.telemetryTempSeen;
                o["tempRaw"] = m.telemetryTempRaw;
                o["voltageSeen"] = m.telemetryVoltageSeen;
                o["voltageRaw"] = m.telemetryVoltageRaw;
                o["currentSeen"] = m.telemetryCurrentSeen;
                o["currentRaw"] = m.telemetryCurrentRaw;
            }
        }
        else if (name == "pins")
        {
            v["menuButton"] = menuButtonPin;
            v["trigger"] = triggerSwitchPin;
            v["rev"] = revSwitchPin;
            v["cycle"] = cycleSwitchPin;
            v["dart"] = dartSwitchPin;
            v["idle"] = idleSwitchPin;
            v["safety"] = safetySwitchPin;
            v["select0"] = selectPins[0];
            v["select1"] = selectPins[1];
            v["select2"] = selectPins[2];
            v["ledData"] = ledDataPin;
            v["batteryAdc"] = batteryAdcPin;
            v["speedPot"] = speedPotPin;
            v["escEnable"] = escEnablePin;
        }
        else if (name == "pinConflicts")
        {
            v["losses"] = PinConflicts::losses();
            v["menuButtonLost"] = PinConflicts::menuButtonLost();
            JsonArray list = v["entries"].to<JsonArray>();
            for (uint8_t i = 0; i < PinConflicts::count(); i++)
            {
                const PinConflicts::Entry& e = PinConflicts::entries()[i];
                JsonObject o = list.add<JsonObject>();
                o["field"] = e.field;
                o["pin"] = e.pin;
                o["against"] = e.against;
                o["action"] = (int)e.action;
            }
        }
        else
            throw Error("nothing to peek called '" + name + "'");
    }
};
} // namespace

int hostMain()
{
#ifdef _WIN32
    _setmode(_fileno(stdin), _O_BINARY);
    _setmode(_fileno(stdout), _O_BINARY);
#endif
    std::ios::sync_with_stdio(false);
    Host host;
    std::string line;
    bool going = true;
    while (going && std::getline(std::cin, line))
    {
        if (!line.empty() && line.back() == '\r')
            line.pop_back();
        if (line.empty())
            continue;
        JsonDocument req, reply;
        JsonObject out = reply.to<JsonObject>();
        const DeserializationError err = deserializeJson(req, line);
        if (err)
        {
            out["ok"] = false;
            out["error"] = std::string("request is not JSON: ") + err.c_str();
        }
        else
        {
            if (!req["id"].isNull())
                out["id"] = req["id"];
            try
            {
                going = host.handle(req.as<JsonObjectConst>(), out);
            }
            catch (const std::exception& e)
            {
                out["ok"] = false;
                out["error"] = e.what();
            }
        }
        serializeJson(reply, std::cout);
        std::cout << '\n' << std::flush;
    }
    return 0;
}
