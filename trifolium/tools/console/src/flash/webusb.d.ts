// The slice of WebUSB the console touches.
//
// lib.dom ships no WebUSB types and @types/w3c-web-usb would be a dependency for four declarations,
// against a build that has to work offline. Everything past requestDevice() is picoflash's problem,
// so USBDevice stays opaque here rather than restating a spec nothing in this repo reads.

interface USBDeviceFilter {
  vendorId?: number;
  productId?: number;
}

interface USBDevice {
  readonly vendorId: number;
  readonly productId: number;
  readonly productName?: string;
  readonly serialNumber?: string;
}

interface USB {
  requestDevice(options: { filters: USBDeviceFilter[] }): Promise<USBDevice>;
  getDevices(): Promise<USBDevice[]>;
}

interface Navigator {
  readonly usb?: USB;
}
