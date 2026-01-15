

trifolium-controller



> Based on `rune-firmware` and the Dettlaff codebase as well as passthrough from the Stinger codebase.  

> Designed for the `trifolium` controller or `Rune` controller or a generic `RP2040` target with FET drive.




## TODO
 - [x] Feed forward control  
 - [x] Telemetry printing  
 - [x] Python live graphing  
 - [x] Screen support  
 - [ ] Menu support  
 - [ ] Auto PID tuning  
 - [ ] PID variables per motor (asymmetrical setup support)  
 - [ ] ESC temperature monitoring  
 - [x] ESC passthrough  
 - [ ] DRV error clearing  
 - [ ] DRV current → closed-loop solenoid control  

## Features
 Maybe works™

## Usage (TODO)
 **Note:** This project uses `PlatformIO` in `VSCode`.
 **To flash a board:**  

 > 1. Hold the `BOOTSEL` button (next to the USB port) while plugging in your USB cable.  
 > 2. The board will show up as a drive named `RPI-RP2`.  
 > 3. Drag the `.uf2` file from the `build/` folder onto the drive.  
 > 4. It will reboot and begin running your code.

