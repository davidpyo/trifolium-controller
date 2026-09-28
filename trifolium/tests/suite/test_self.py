"""The simulator's own fakes, checked by trifolium-sim --self-test: every other verdict rests on
them."""

import subprocess

from trifolium_sim import EXE


def test_the_fake_board_behaves_like_the_parts_it_stands_in_for():
    result = subprocess.run([str(EXE), "--self-test"], capture_output=True, text=True, timeout=120)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "Status: SUCCESS" in result.stdout
