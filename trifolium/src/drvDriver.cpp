#include "drvDriver.h"


Drv::Drv(uint8_t in1, uint8_t in2, uint8_t nsleep_pin, uint8_t mosi_pin, uint8_t miso_pin, uint8_t nscs_pin, uint8_t sclk_pin) {
    ph = in1;
    en = in2;
    nsleep = nsleep_pin;
    mosi = mosi_pin;
    miso = miso_pin;
    nscs = nscs_pin;
    sclk = sclk_pin;
}

void Drv::init() {
    pinMode(nsleep, OUTPUT);
    digitalWrite(nsleep, LOW);

    pinMode(ph, OUTPUT);
    digitalWrite(ph, LOW);

    pinMode(en, OUTPUT);
    digitalWrite(en, LOW);

    pinMode(mosi, OUTPUT);
    pinMode(miso, INPUT);
    pinMode(sclk, OUTPUT);
    pinMode(nscs, OUTPUT);
    digitalWrite(nscs, HIGH);

    SPI.begin();

    if (!wake())
    {
        Serial.println("DRV initialization failed!");
        return;
    }
}

bool Drv::wake() {
    digitalWrite(nsleep, HIGH);
    delayMicroseconds(2000);

    uint16_t devID = readWord(0x00);
    if ((devID & 0xc0) == 0) {
        digitalWrite(nsleep, LOW);
        return false;
    }

    writeWord(0x08, (1 << 7));
    devID = readWord(0x00);
    if ((devID & (1 << 13))) {
        digitalWrite(nsleep, LOW);
        return false;
    }

    // Device config (example, may need adjustment)
    uint16_t tmpReg = readWord(0x0c);
    tmpReg = (tmpReg & ~0x03) | 0x03;
    writeWord(0x0c, tmpReg & 0xff);

    return true;
}

void Drv::sleep() {
    digitalWrite(nsleep, LOW);
}

void Drv::drive() {
    digitalWrite(ph, LOW);
    digitalWrite(en, HIGH);
}


void Drv::drive(float dutyCycle, bool reverseDirection) {
    digitalWrite(ph, LOW);
    if (dutyCycle < 0.0) dutyCycle = 0.0;
    else if (dutyCycle > 1.0) dutyCycle = 1.0;
    analogWrite(en, (uint16_t)(dutyCycle * 255)); // Arduino PWM: 0-255
}

void Drv::brake() {
    digitalWrite(ph, LOW);
    digitalWrite(en, LOW);
}

void Drv::coast() {
    digitalWrite(ph, HIGH);
    digitalWrite(en, HIGH);
}

int Drv::writeWord(uint8_t addr, uint8_t data) {
    uint16_t buf = ((addr & 0x3f) << 8) | data;
    digitalWrite(nscs, LOW);
    SPI.beginTransaction(SPISettings(500000, MSBFIRST, SPI_MODE1));
    SPI.transfer16(buf);
    SPI.endTransaction();
    digitalWrite(nscs, HIGH);
    delayMicroseconds(10);
    return 1;
}

uint16_t Drv::readWord(uint8_t address) {
    uint16_t bufTX = (uint16_t)(((address & 0x3f) | 0x40) << 8);
    digitalWrite(nscs, LOW);
    SPI.beginTransaction(SPISettings(500000, MSBFIRST, SPI_MODE1));
    uint16_t bufRX = SPI.transfer16(bufTX);
    SPI.endTransaction();
    digitalWrite(nscs, HIGH);
    delayMicroseconds(10);
    return bufRX;
}