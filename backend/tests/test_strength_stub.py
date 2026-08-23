"""Strength is not built. It must crash, never guess."""

import pytest

from physics.equations import strength


# a stub that silently returns zeros is worse than one that crashes
@pytest.mark.parametrize(
    ("call", "match"),
    [
        (lambda: strength.strength_mpa(24.0, 40.0, 20.0, 1.0), "not researched"),
        (lambda: strength.strength_fraction(24.0, 40.0, 20.0, 1.0), "calibration"),
    ],
)
def test_strength_stubs_raise(call, match: str) -> None:  # type: ignore[no-untyped-def]
    with pytest.raises(NotImplementedError, match=match):
        call()
