"""DUMP_SPLASH: the image the next boot draws, as one JSON line the console can read back."""

import base64

from helpers import armed_v12

SPLASH_BYTES = 128 * 64 // 8


def dumped(b):
    reply = b.command("DUMP_SPLASH")
    assert reply["ok"] is True
    return reply["custom"], base64.b64decode(reply["b64"])


def test_with_no_custom_splash_it_reports_the_built_in_one(blaster):
    b = armed_v12(blaster, display=False)
    custom, image = dumped(b)
    assert custom is False
    assert len(image) == SPLASH_BYTES
    assert any(image)  # the built-in art, not an empty buffer


def test_a_custom_splash_is_reported_byte_for_byte(blaster):
    b = blaster
    image = bytes((i * 37) & 0xFF for i in range(SPLASH_BYTES))
    b.flash_preset("trifolium_v1_2")
    b.flash_put("/splash.bin", image)
    assert b.boot(100)
    assert dumped(b) == (True, image)


def test_a_splash_file_of_the_wrong_size_is_not_custom(blaster):
    """SplashStore refuses it at boot as well, so the built-in one is what shows."""
    b = blaster
    b.flash_preset("trifolium_v1_2")
    b.flash_put("/splash.bin", b"\x01" * 100)
    assert b.boot(100)
    custom, image = dumped(b)
    assert custom is False and len(image) == SPLASH_BYTES
