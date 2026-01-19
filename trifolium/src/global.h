#include "types.h"

#define MAJOR_VERSION 1
#define MINOR_VERSION 2
#define PATCH_VERSION 0

extern BootReason bootReason; // Reason for booting
extern BootReason rebootReason; // Reason for rebooting (can be set right before an intentional reboot, WATCHDOG otherwise)
extern u64 powerOnResetMagicNumber; // Magic number to detect power-on reset (0xdeadbeefdeadbeef)
