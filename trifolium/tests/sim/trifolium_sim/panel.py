"""The OLED as the user sees it: rebuilt by the host from the I2C bytes the firmware sent, and read
back as the size-1 text on it, with the highlighted row marked."""

from dataclasses import dataclass

WIDTH, HEIGHT = 128, 64


@dataclass
class Line:
    x: int
    y: int
    text: str
    highlighted: bool


class Panel:
    def __init__(self, reply):
        self.attached = reply["attached"]
        self.on = reply["on"]
        self.contrast = reply["contrast"]
        self.inverted = reply["inverted"]
        self.data_bytes = reply["dataBytes"]
        self.highlighted = reply["highlighted"]
        self.lines = [Line(**line) for line in reply["lines"]]
        self.pixels = reply.get("pixels", "").splitlines() if reply.get("pixels") else None

    @property
    def text(self):
        """Every line, top to bottom, the highlighted one marked with '>'."""
        return "\n".join(("> " if l.highlighted else "  ") + l.text for l in self.lines)

    def shows(self, text):
        return any(text in line.text for line in self.lines)

    def pbm(self):
        if self.pixels is None:
            raise ValueError("read the panel with pixels=True")
        return f"P1\n{WIDTH} {HEIGHT}\n" + "\n".join(self.pixels) + "\n"

    def ascii(self):
        if self.pixels is None:
            raise ValueError("read the panel with pixels=True")
        return "\n".join(row.replace("1", "#").replace("0", ".") for row in self.pixels)

    def __repr__(self):
        return f"<Panel on={self.on}>\n{self.text}"
