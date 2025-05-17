#include <Arduino.h>
#include <PIO_DShot.h>

#define PIN 10
#define MOTOR_POLES 14

BidirDShotX1 *esc;
uint16_t throttle = 0;
uint32_t rpm = 0;

void setup() {
	Serial.begin(115200);

// initialize the ESC. This cannot be done globally, because we need to have the CPU running and tell us the frequency. Trying that crashed it for me. Also, do not call the constructor before you set the final clock speed on your CPU. If you change the clock speed, you should be fine by just destroying the previous DShot object and recreating it into the same pointer.
// if you need more than one output, just use multiple BidirDShotX1 objects with a different pin for each. It is recommended to dedicate an entire PIO block to Bidir dshot, because it takes almost the full instruction table. Up to 4 motors can be assigned to one PIO block, and if that's not enough, just create more objects on the second PIO block
	esc = new BidirDShotX1(PIN);
// there are some optional arguments: speed (e.g. 600 for DShot600), pio block (e.g. pio0 for the first PIO block), and a fixed SM (-1 for automatic selection).
// speeds are supported from 150-4800, though only 300, 600 or 1200 are recommended. PIO block has to be pio0 or pio1. SM can be 0-3, or -1 for automatic. If there's no SM free on this PIO, or you try to force an already claimed PIO, initialization will fail. Check the initError() function if there was an error initializing. You can go into the config.h file of the library and set the DEBUG_DSHOT, then you can see some Serial prints with more information.
}

void loop() {
// You need to space out the packets: https://github.com/bastian2001/pico-bidir-dshot/wiki/Timing-of-packets
	delayMicroseconds(200);

// call this function at minimum 87µs after you sent the last throttle, to receive the most current eRPM packet.
	esc->getTelemetryErpm(&rpm);
// convert eRPM to RPM
	rpm /= MOTOR_POLES / 2; // eRPM = RPM * poles/2

// send a throttle value between 0 (0% = stop) and 2000 (100%)
	esc->sendThrottle(throttle);

// print the throttle and RPM every 100ms
	static uint32_t lastTime = 0;
	if (millis() - lastTime > 100) {
		lastTime = millis();
		Serial.print(throttle);
		Serial.print("\t");
		Serial.println(rpm);
	}

	if (Serial.available()) {
		delay(3); // wait for the rest of the input
		String s = "";
		while (Serial.available()) {
			s += (char)Serial.read();
		}
		int32_t t = s.toInt();
// constrain limits the throttle value t to a max of 2000, and a min of 0. While the sendThrottle function also checks that you don't have anything >2000, it acts only as a one way limit because the variable th
		t = constrain(t, 0, 2000);
		throttle = t;
	}
}