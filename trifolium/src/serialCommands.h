#pragma once

void serialCommandsBegin();

void handleSerialCommands();

// True while handleSerialCommands() is servicing a command on core 1. Core 0 checks it before
// starting an RPM log dump, so a multi-line CSV can't interleave into DUMP_SCHEMA's single line.
extern volatile bool serialCommandBusy;

// Set on the first command this boot. The unconfigured announcement stops once a host has spoken,
// so its event line can't be mistaken for a reply by a tool reading the first JSON line it sees.
extern volatile bool serialCommandSeen;
