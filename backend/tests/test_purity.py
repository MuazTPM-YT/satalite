"""physics/ must import nothing from the web layer. Architectural, enforced here."""

import ast
from pathlib import Path

import pytest

PHYSICS_DIR = Path(__file__).resolve().parents[1] / "physics"
BANNED = {"fastapi", "pydantic", "app", "starlette", "vendor", "requests"}

MODULES = sorted(PHYSICS_DIR.rglob("*.py"))


# top-level package of a dotted module path
def _root(name: str) -> str:
    return name.split(".")[0]


@pytest.mark.parametrize("path", MODULES, ids=lambda p: p.name)
def test_physics_imports_nothing_from_web_layer(path: Path) -> None:
    tree = ast.parse(path.read_text(), filename=str(path))
    found: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            found += [_root(alias.name) for alias in node.names]
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            found.append(_root(node.module))
    assert not (BANNED & set(found)), f"{path.name} imports {BANNED & set(found)}"


def test_physics_modules_found() -> None:
    assert MODULES, "no physics modules found - purity test would pass vacuously"
