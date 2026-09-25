// @vitest-environment jsdom

// The refusals are the part worth pinning: a drop that reaches a picker's handler with the wrong
// file is a parse error several layers in, which is what the accept check exists to prevent.

import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { DropLabel, acceptsFile, useFileDrop, type FileDropOptions } from "./FileDrop";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const file = (name: string, type = "") => new File(["x"], name, { type });

/** jsdom has no DataTransfer, and React reads the property straight off the native event. */
const fire = (target: Element, type: string, files: File[], types = ["Files"]) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { types, files, dropEffect: "" } });
  act(() => {
    target.dispatchEvent(event);
  });
};

/** Stands in for a panel: the hook's handlers on an element that was going to be there anyway. */
function Panel(options: FileDropOptions) {
  const { over, dropProps } = useFileDrop(options);
  return (
    <div {...dropProps}>
      <DropLabel over={over} label="Drop a .uf2 here" />
      <span id="child">inner</span>
    </div>
  );
}

const mount = (options: Partial<FileDropOptions> = {}) => {
  const onFile = vi.fn();
  const onReject = vi.fn();
  const container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    createRoot(container).render(
      <Panel
        accept={[".uf2", "application/octet-stream"]}
        what="a .uf2 firmware image"
        onFile={onFile}
        onReject={onReject}
        {...options}
      />,
    );
  });
  return { zone: container.firstElementChild!, container, onFile, onReject };
};

describe("acceptsFile", () => {
  it("matches an extension whatever the type says", () => {
    expect(acceptsFile(file("fw.uf2"), [".uf2"])).toBe(true);
    expect(acceptsFile(file("FW.UF2"), [".uf2"])).toBe(true);
  });

  it("matches a wildcard and an exact type", () => {
    expect(acceptsFile(file("logo.png", "image/png"), ["image/*"])).toBe(true);
    expect(acceptsFile(file("cap.csv", "text/plain"), ["text/plain"])).toBe(true);
    expect(acceptsFile(file("cap.csv", "text/plain"), ["image/*"])).toBe(false);
  });

  it("refuses a file that matches no entry", () => {
    expect(acceptsFile(file("backup.json", "application/json"), [".uf2"])).toBe(false);
  });
});

describe("useFileDrop", () => {
  it("hands an accepted file to the picker's own handler", () => {
    const { zone, onFile, onReject } = mount();
    fire(zone, "drop", [file("fw.uf2")]);
    expect(onFile).toHaveBeenCalledOnce();
    expect(onFile.mock.calls[0][0].name).toBe("fw.uf2");
    expect(onReject).not.toHaveBeenCalled();
  });

  it("refuses the wrong kind of file by name", () => {
    const { zone, onFile, onReject } = mount();
    fire(zone, "drop", [file("splash.png", "image/png")]);
    expect(onFile).not.toHaveBeenCalled();
    expect(onReject).toHaveBeenCalledWith("splash.png is not a .uf2 firmware image.");
  });

  it("refuses a multi-file drop rather than taking the first", () => {
    const { zone, onFile, onReject } = mount();
    fire(zone, "drop", [file("a.uf2"), file("b.uf2")]);
    expect(onFile).not.toHaveBeenCalled();
    expect(onReject).toHaveBeenCalledWith("Drop one file at a time - 2 were dropped.");
  });

  it("ignores a drop while disabled", () => {
    const { zone, onFile, onReject } = mount({ disabled: true });
    fire(zone, "drop", [file("fw.uf2")]);
    expect(onFile).not.toHaveBeenCalled();
    expect(onReject).not.toHaveBeenCalled();
  });

  it("ignores dragged text, so a selection does not light the zone up", () => {
    const { zone, container } = mount();
    fire(zone, "dragenter", [], ["text/plain"]);
    expect(container.textContent).not.toContain("Drop a .uf2 here");
  });

  it("keeps the label up when the pointer crosses a child", () => {
    const { zone, container } = mount();
    const child = container.querySelector("#child")!;
    fire(zone, "dragenter", []);
    fire(child, "dragenter", []);
    fire(child, "dragleave", []);
    expect(container.textContent).toContain("Drop a .uf2 here");
    fire(zone, "dragleave", []);
    expect(container.textContent).not.toContain("Drop a .uf2 here");
  });
});
