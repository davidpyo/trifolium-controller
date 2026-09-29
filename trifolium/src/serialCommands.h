#pragma once

void serialCommandsBegin();

void handleSerialCommands();

// Set on the first command this boot. The unconfigured announcement stops once a host has spoken,
// so its event line can't be mistaken for a reply by a tool reading the first JSON line it sees.
extern volatile bool serialCommandSeen;
