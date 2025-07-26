#include "drvDriver.h"


Drv::Drv(uint8_t in1, uint8_t in2, uint8_t nsleep_pin, uint8_t mosi_pin, uint8_t miso_pin, uint8_t nscs_pin, uint8_t sclk_pin) {
    ph = in1;
    en = in2;
    nsleep = nsleep_pin;
    mosi = mosi_pin;
    miso = miso_pin;
    nscs = nscs_pin;
    sclk = sclk_pin;
    init();
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
    SPI1 = SPIClassRP2040(spi0, miso, nscs, sclk, mosi);
    /*SPI.setSCK(sclk); //22
    SPI.setMOSI(mosi); //19
    SPI.setMISO(miso); //20
    SPI.setCS(nscs); //21
    */
    SPI1.begin();

    while (!wake())
    {
        Serial.println("DRV initialization failed!");
        delay(1000);
    }
}

bool Drv::wake() {
    digitalWrite(nsleep, HIGH);
    delayMicroseconds(2000);

    uint16_t devID = readWord(0x00);
    Serial.print("DRV Device ID: 0x");
    Serial.println(devID, HEX); 
    if ((devID & 0xc0) == 0) {
        digitalWrite(nsleep, LOW);
         Serial.println("1!");
        return false;
    }

    writeWord(0x08, (1 << 7));
    devID = readWord(0x00);
    Serial.print("DRV Device ID: 0x");
    Serial.println(devID, HEX); 
    if ((devID & (1 << 13))) {
        digitalWrite(nsleep, LOW);
        Serial.println("2!");
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
    SPI1.beginTransaction(SPISettings(500000, MSBFIRST, SPI_MODE1));
    SPI1.transfer16(buf);
    SPI1.endTransaction();
    digitalWrite(nscs, HIGH);
    delayMicroseconds(10);
    return 1;
}

uint16_t Drv::readWord(uint8_t address) {
    uint16_t bufTX = (uint16_t)(((address & 0x3f) | 0x40) << 8);
    digitalWrite(nscs, LOW);
    SPI1.beginTransaction(SPISettings(500000, MSBFIRST, SPI_MODE1));
    uint16_t bufRX = SPI1.transfer16(bufTX);
    SPI1.endTransaction();
    digitalWrite(nscs, HIGH);
    delayMicroseconds(10);
    return bufRX;
}