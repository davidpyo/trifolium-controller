// The browser Chrome on Android is, for a page talking to the simulator: no navigator.serial, and a
// navigator.usb with one CDC-ACM device bridged to serve.py's WebSocket at window.__SIM_SERIAL_URL.
// The console then runs its WebUSB polyfill. Behaves the way WebUSB does where the polyfill or the
// console can tell the difference - open() fails while the device is re-enumerating, a reboot loses
// the USBDevice and a new one takes its place, close() aborts pending transfers, and transfers
// complete in the order they were queued. serve.py names the boot each connection reaches, so a
// reboot while the page had the device closed still loses this USBDevice, however late it reopens.
//
// window.__simUsb.pickerCancels = true makes requestDevice() reject as a dismissed picker does.
// window.__simUsb.granted = true is a browser that already allowed the device on an earlier visit.
(() => {
  const lost = () => new DOMException("The device was disconnected.", "NotFoundError");
  const closed = () => new DOMException("The device must be opened first.", "InvalidStateError");

  const configuration = () => {
    const iface = (interfaceNumber, interfaceClass, endpoints) => {
      const alternate = { alternateSetting: 0, interfaceClass, interfaceSubclass: 0,
                          interfaceProtocol: 0, endpoints };
      return { interfaceNumber, alternate, alternates: [alternate], claimed: false };
    };
    const endpoint = (endpointNumber, direction, type) =>
      ({ endpointNumber, direction, type, packetSize: 64 });
    return {
      configurationValue: 1,
      interfaces: [
        iface(0, 2, [endpoint(1, "in", "interrupt")]),
        iface(1, 10, [endpoint(2, "out", "bulk"), endpoint(2, "in", "bulk")]),
      ],
    };
  };

  class SimUsbDevice {
    constructor(url) {
      this.url = url;
      this.vendorId = 0x2e8a;
      this.productId = 0x000a;
      this.productName = "Trifolium";
      this.configurations = [configuration()];
      this.configuration = null;
      this.opened = false;
      this.gone = false;
      this.boot = null;
      this.ws = null;
      this.received = [];
      this.waiting = [];
    }

    async open() {
      if (this.gone) throw lost();
      if (this.opened) return;
      const ws = new WebSocket(this.url);
      ws.binaryType = "arraybuffer";
      const boot = await new Promise((resolve, reject) => {
        ws.onmessage = (e) => typeof e.data === "string" && resolve(JSON.parse(e.data).boot);
        ws.onerror = () => reject(new DOMException("Failed to open the device.", "NetworkError"));
      });
      if (this.boot !== null && boot !== this.boot) {
        ws.close(); // rebooted since this object last had it: gone, and a new one in its place
        this.lose();
        throw lost();
      }
      this.boot = boot;
      this.ws = ws;
      this.opened = true;
      ws.onmessage = (e) => {
        this.received.push(new Uint8Array(e.data));
        this.deliver();
      };
      ws.onclose = () => {
        if (this.ws === ws) this.lose(); // the page did not close it: the device left the bus
      };
    }

    lose() {
      if (this.gone) return;
      this.gone = true;
      this.opened = false;
      this.ws = null;
      for (const { reject } of this.waiting.splice(0)) reject(lost());
      if (state.device === this) state.device = new SimUsbDevice(this.url);
    }

    async close() {
      if (!this.opened) return;
      const ws = this.ws;
      this.ws = null;
      this.opened = false;
      this.configuration = null;
      for (const { reject } of this.waiting.splice(0)) {
        reject(new DOMException("The transfer was cancelled.", "AbortError"));
      }
      this.received = [];
      if (ws && ws.readyState <= WebSocket.OPEN) ws.close();
    }

    async selectConfiguration() {
      if (!this.opened) throw closed();
      this.configuration = this.configurations[0];
    }

    async claimInterface(number) {
      if (!this.opened) throw closed();
      this.configurations[0].interfaces[number].claimed = true;
    }

    async releaseInterface(number) {
      this.configurations[0].interfaces[number].claimed = false;
    }

    async controlTransferOut(setup, data) {
      if (this.gone) throw lost();
      if (!this.opened) throw closed();
      return { status: "ok", bytesWritten: data ? data.byteLength : 0 };
    }

    transferIn(endpointNumber, length) {
      if (this.gone) return Promise.reject(lost());
      if (!this.opened) return Promise.reject(closed());
      return new Promise((resolve, reject) => {
        this.waiting.push({ length, resolve, reject });
        this.deliver();
      });
    }

    async transferOut(endpointNumber, data) {
      if (this.gone || !this.ws || this.ws.readyState !== WebSocket.OPEN) throw lost();
      if (!this.opened) throw closed();
      this.ws.send(data);
      return { status: "ok", bytesWritten: data.byteLength };
    }

    deliver() {
      while (this.waiting.length && this.received.length) {
        const { length, resolve } = this.waiting.shift();
        const out = [];
        let size = 0;
        while (this.received.length && size < length) {
          const chunk = this.received[0];
          const take = Math.min(chunk.length, length - size);
          out.push(chunk.subarray(0, take));
          size += take;
          if (take === chunk.length) this.received.shift();
          else this.received[0] = chunk.subarray(take);
        }
        const data = new Uint8Array(size);
        let at = 0;
        for (const part of out) {
          data.set(part, at);
          at += part.length;
        }
        resolve({ status: "ok", data: new DataView(data.buffer) });
      }
    }
  }

  const matches = (device, filter) =>
    (filter.vendorId === undefined || filter.vendorId === device.vendorId) &&
    (filter.productId === undefined || filter.productId === device.productId) &&
    (filter.classCode === undefined ||
      device.configurations[0].interfaces.some((i) => i.alternate.interfaceClass === filter.classCode));

  const state = { granted: false, pickerCancels: false, device: new SimUsbDevice(window.__SIM_SERIAL_URL) };
  window.__simUsb = state;

  const usb = {
    async requestDevice({ filters }) {
      if (state.pickerCancels || !filters.some((f) => matches(state.device, f))) {
        throw new DOMException("No device selected.", "NotFoundError");
      }
      state.granted = true;
      return state.device;
    },
    async getDevices() {
      return state.granted ? [state.device] : [];
    },
    addEventListener() {},
    removeEventListener() {},
  };
  delete Navigator.prototype.serial;
  Object.defineProperty(Navigator.prototype, "usb", { get: () => usb, configurable: true });
})();
