"""Where diagnostic scripts put their numbers so they outlive a terminal scrollback."""

import json
import subprocess
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

RESULTS_DIR = Path(__file__).resolve().parents[1] / "results"


# short commit the numbers came from, or "unknown" outside a checkout.
def _revision() -> str:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            capture_output=True, text=True, check=True, cwd=RESULTS_DIR.parent,
        )
    except (OSError, subprocess.CalledProcessError):
        return "unknown"
    return out.stdout.strip()


# one run, one file, stamped with the commit it came from. returns the path written.
def write(name: str, payload: dict[str, Any]) -> Path:
    RESULTS_DIR.mkdir(exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    revision = _revision()
    path = RESULTS_DIR / f"{name}-{stamp}-{revision}.json"
    path.write_text(
        json.dumps(
            {"script": name, "written_at": stamp, "revision": revision, **payload},
            indent=2, sort_keys=True,
        )
        + "\n"
    )
    return path
