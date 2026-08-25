#include "menuCore.h"

static const char* const batteryTypeLabels[] = {"3S", "4S", "5S", "6S"};
static EnumItem<batteryType_t> batteryTypeItem("Battery Type", &deviceSettings.batteryType,
                                               batteryTypeLabels, 4);
static NumericItem<uint32_t> lowVoltageCutoffItem("Low V Cutoff (mV/cell)",
                                                  &deviceSettings.lowVoltageCutoffPerCell_mv, 3000,
                                                  3800, 50);
// Earlier, non-cutoff warning threshold - expected above the cutoff so it trips first.
static NumericItem<uint32_t> lowVoltageWarningItem("Low V Warning (mV/cell)",
                                                   &deviceSettings.lowVoltageWarningPerCell_mv,
                                                   3000, 3800, 50);
// Applies live via BatteryMonitor::updateCalibration(), called from runMenu()'s post-save hook.
static FloatItem voltageCalibrationItem("Volt Calibration",
                                        &deviceSettings.voltageCalibrationFactor, 0.5f, 1.5f, 0.1f,
                                        3);

// Spins all enabled motors at a low fixed throttle to bleed the pack down to a target per-cell
// storage voltage, then stops and alerts. Blocks for the duration; any button press aborts early.
static const int32_t STORAGE_DISCHARGE_THROTTLE = 150;
static const uint32_t STORAGE_VOLTAGE_PER_CELL_MV = 3800;

static void storageDischargeFired()
{
    if (!batteryMonitor->isDefined())
    {
        showTrapdoor(
            "No battery sense ADC\nconfigured - can't\nsafely discharge.\nany press = back");
        return;
    }

    uint32_t targetVoltage_mv = STORAGE_VOLTAGE_PER_CELL_MV * cellCount(deviceSettings.batteryType);
    directMotorControlActive = true;
    unsigned long lastUpdate = 0;
    bool stoppedByUser = false;
    DismissDetector dismiss;
    while (batteryMonitor->getVoltage_mv() > (int32_t)targetVoltage_mv)
    {
        handleSerialCommands();
        menuButton.update();
        for (int i = 0; i < 4; i++)
        {
            if (deviceSettings.motorConfig[i].enabled && !isPusherEscChannel(i))
                motorArr[i].sendThrottle(STORAGE_DISCHARGE_THROTTLE);
        }
        if (millis() - lastUpdate > 200)
        {
            display.clearDisplay();
            display.setTextSize(1);
            display.setCursor(0, 0);
            display.println("Storage Discharge");
            display.drawFastHLine(0, 10, 128, 1);
            display.setCursor(0, 20);
            display.print("Now: " + String(batteryMonitor->getVoltage_mv() / 1000.0, 2) + "V");
            display.setCursor(0, 32);
            display.print("Target: " + String(targetVoltage_mv / 1000.0, 2) + "V");
            display.setCursor(0, 56);
            display.print("any press = stop");
            display.display();
            lastUpdate = millis();
        }
        if (dismiss.poll())
        {
            stoppedByUser = true;
            break;
        }
        delay(2);
    }
    for (int i = 0; i < 4; i++)
    {
        if (deviceSettings.motorConfig[i].enabled)
            motorArr[i].sendThrottle(0);
    }
    directMotorControlActive = false;

    String resultMessage = stoppedByUser ? "Stopped by you\n" : "Target reached\n";
    resultMessage += "Now: " + String(batteryMonitor->getVoltage_mv() / 1000.0, 2) + "V\n";
    resultMessage += "Target: " + String(targetVoltage_mv / 1000.0, 2) + "V\n";
    resultMessage += "any press = back";
    showTrapdoor(resultMessage);
}
static ActionItem storageDischargeItem("Storage Discharge", storageDischargeFired);

static MenuItem* batteryItems[] = {
    &batteryTypeItem,        &lowVoltageCutoffItem, &lowVoltageWarningItem,
    &voltageCalibrationItem, &storageDischargeItem,
};
// Non-static: referenced by menu.cpp's Advanced submenu assembly.
SubmenuItem batterySubmenu("Battery", batteryItems, 5);
