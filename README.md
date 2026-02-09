

trifolium-controller



> Based on `rune-firmware` and the Dettlaff codebase as well as passthrough from the Stinger codebase.  

> Designed for the `trifolium` controller or `Rune` controller or a generic `RP2040` target with FET drive.

> Here's a video on setup and an overview of the board: https://www.youtube.com/live/lg1xlSH4bGQ?si=-dB7dRIhKSCSjfnB


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

 > 1. Press the "Upload" button in PlatformIO (if board has not been flashed before, putting the board in bootloader mode may be required).

