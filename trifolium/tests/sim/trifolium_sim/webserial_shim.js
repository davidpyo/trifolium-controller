// navigator.serial for a page talking to the simulator: one port, bridged to serve.py's WebSocket at
// window.__SIM_SERIAL_URL. Behaves the way Web Serial does where the console can tell the
// difference - open() fails while the device is re-enumerating, a reboot errors the readable stream
// with "device lost", and close() leaves the port ready to open again.
//
// window.__simSerial.pickerCancels = true makes requestPort() reject as a dismissed picker does.
// window.__simSerial.granted = true is a browser that already allowed the port on an earlier visit.
(() => {
  const lost = () => new DOMException("The device has been lost.", "NetworkError");

  class SimSerialPort extends EventTarget {
    constructor(url) {
      super();
      this.url = url;
      this.ws = null;
      this.readable = null;
      this.writable = null;
    }

    getInfo() {
      return { usbVendorId: 0x2e8a, usbProductId: 0x000a };
    }

    async open() {
      if (this.ws) throw new DOMException("The port is already open.", "InvalidStateError");
      const ws = new WebSocket(this.url);
      ws.binaryType = "arraybuffer";
      await new Promise((resolve, reject) => {
        ws.onopen = resolve;
        ws.onerror = () => reject(new DOMException("Failed to open serial port.", "NetworkError"));
      });
      this.ws = ws;
      let source = null;
      this.readable = new ReadableStream({
        start(controller) {
          source = controller;
        },
      });
      ws.onmessage = (e) => {
        if (typeof e.data !== "string") source.enqueue(new Uint8Array(e.data)); // text: serve.py's hello
      };
      ws.onclose = () => {
        try {
          source.error(lost());
        } catch {
          // already closed by the page
        }
        if (this.ws === ws) {
          this.ws = null;
          this.readable = null;
          this.writable = null;
        }
      };
      this.writable = new WritableStream({
        write(chunk) {
          if (ws.readyState !== WebSocket.OPEN) throw lost();
          ws.send(chunk);
        },
      });
    }

    async close() {
      const ws = this.ws;
      this.ws = null;
      this.readable = null;
      this.writable = null;
      if (ws && ws.readyState <= WebSocket.OPEN) ws.close();
    }
  }

  const port = new SimSerialPort(window.__SIM_SERIAL_URL);
  const state = { granted: false, pickerCancels: false, port };
  window.__simSerial = state;

  const serial = {
    async requestPort() {
      if (state.pickerCancels) throw new DOMException("No port selected by the user.", "NotFoundError");
      state.granted = true;
      return port;
    },
    async getPorts() {
      return state.granted ? [port] : [];
    },
    addEventListener() {},
    removeEventListener() {},
  };
  Object.defineProperty(Navigator.prototype, "serial", { get: () => serial, configurable: true });
})();
