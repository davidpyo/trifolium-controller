#include "types.h"

extern BootReason bootReason; // Reason for booting
extern BootReason rebootReason; // Reason for rebooting (can be set right before an intentional reboot, WATCHDOG otherwise)
extern u64 powerOnResetMagicNumber; // Magic number to detect power-on reset (0xdeadbeefdeadbeef)
