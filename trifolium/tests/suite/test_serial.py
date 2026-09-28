"""Both cores print on the one USB serial port: core 1 answers the host, core 0 logs.

With verbose logging on, core 0 is still logging through its boot when core 1 starts answering. The
console's first read after a restart lands there on hardware, about a second in, once the port has
enumerated - on the splash's end, where core 0 logs its settings.
"""

import json
import re

LOG_LINE = re.compile(r"^\d+ (\[(?:FATAL|ERROR|WARN|INFO)\] .*?)\r?$", re.M)


def verbose_v12(b):
    b.flash_preset("trifolium_v1_2", {"printTelemetry": True})
    b.attach_display()
    return b


def logged(b):
    """Every log line the blaster printed, less its timestamp."""
    return sorted(LOG_LINE.findall(b.transcript))


def test_a_reply_during_a_verbose_boot_arrives_whole_and_no_log_line_is_lost(make_blaster):
    alone = verbose_v12(make_blaster())
    assert alone.boot(8000)
    expected = logged(alone)
    assert expected, "a verbose boot logs something"

    # Back to back through the boot's first 1.5 s, so some read is going out whenever core 0 logs.
    b = verbose_v12(make_blaster())
    b.power_on()
    assert b.command("DUMP_BOOT", timeout_ms=5000)  # answered as soon as core 1 serves
    replies = []
    while b.uptime_ms < 1500:
        replies.append(b.command("DUMP_SCHEMA", timeout_ms=15000, parse=False))
    for reply in replies:
        assert json.loads(reply)["cmd"] == "DUMP_SCHEMA"
    assert b.run_ms(8000)
    assert logged(b) == expected
