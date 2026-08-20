"""The unit law, enforced by ast walk.

Every temperature-carrying name in physics/ must declare its scale in its suffix:
_c celsius, _k kelvin, _f fahrenheit. Ambiguous temperature units are the single most
likely way this project produces confidently wrong output, so it is a test, not a habit.
"""

import ast
import re
from pathlib import Path

import pytest

PHYSICS_DIR = Path(__file__).resolve().parents[1] / "physics"
MODULES = sorted(PHYSICS_DIR.rglob("*.py"))

# anything containing "temp" in any case, plus the UPPERCASE T / T_something convention.
# lowercase t_ is deliberately excluded: t_e_h is an equivalent age, not a temperature.
TEMPERATURE_NAME = re.compile(r"(?i:temp)|^T($|_)")
# the scale must appear as its own token, so temp_c_frames counts and temp_factor does not
DECLARES_SCALE = re.compile(r"_[ckf](_|$)", re.IGNORECASE)


# every name bound anywhere in the module: arguments, fields, assignments.
def _bound_names(tree: ast.AST) -> set[str]:
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.arg):
            names.add(node.arg)
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            names.add(node.target.id)
        elif isinstance(node, ast.Assign):
            names |= {t.id for t in node.targets if isinstance(t, ast.Name)}
    return names


@pytest.mark.parametrize("path", MODULES, ids=lambda p: p.name)
def test_every_temperature_name_declares_its_scale(path: Path) -> None:
    tree = ast.parse(path.read_text(), filename=str(path))
    offenders = sorted(
        name
        for name in _bound_names(tree)
        if TEMPERATURE_NAME.search(name) and not DECLARES_SCALE.search(name)
    )
    assert not offenders, f"{path.name}: temperature names without _c/_k/_f: {offenders}"


# the regex has to actually reject the things it exists to reject
def test_the_rule_would_catch_a_violation() -> None:
    bad = ast.parse("def f(T_air, surface_temp, ambient_temperature): pass")
    caught = sorted(
        n
        for n in _bound_names(bad)
        if TEMPERATURE_NAME.search(n) and not DECLARES_SCALE.search(n)
    )
    assert caught == ["T_air", "ambient_temperature", "surface_temp"]


def test_modules_found() -> None:
    assert len(MODULES) >= 10, "naming test would pass vacuously"
