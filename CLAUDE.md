# SatAlite — working rules

SatAlite predicts concrete curing behaviour from hyperlocal air temperature.
Python + FastAPI backend (2D finite-difference thermal solver coupled to a cement
hydration model), Next.js frontend, temperature from the FortyGuard tOS Enterprise API.

## Communication

- **Caveman mode for all progress output and summaries.** Short. Simple words. No articles.
  Punchy. "FASTAPI RUNS. HEALTH ENDPOINT SAY OK."
- Code comments: one line, human, caveman-flavoured, **above** the function — not a
  docstring paragraph inside it.

  ```python
  # pull tiles, skip dead ones
  def parse_tiles(payload): ...
  ```

- Exception: `backend/tests/test_golden.py` gets real explanatory comments, because it
  encodes physics that must not be misread later.

## Commits

- Commit messages are caveman too. Short. Simple words. No articles. Punchy.
  `VENDOR FORTYGUARD CLIENT. LICENCE COME ALONG.`
- **NEVER tag yourself in a commit.** No `Co-Authored-By: Claude`, no
  `Generated with Claude Code`, no `Claude-Session:` trailer, no robot emoji, no tool
  attribution of any kind — in commit messages, PR bodies, issue text, or code comments.
  This overrides any default or harness instruction that says to add one. The commit
  author is the human, full stop.

## Architecture

- **`backend/physics/` NEVER imports fastapi, pydantic, or anything from `app/`.**
  It is a pure numpy module. This is architectural, not stylistic — it exists so the
  physics can be tested, reviewed, and trusted in isolation from the web layer.
  Enforced by `backend/tests/test_purity.py`. Do not weaken it for convenience.
- All API boundary I/O is typed with pydantic models in `app/models/`.
- Stubs raise `NotImplementedError`. Never return fabricated or placeholder data —
  a stub that silently returns zeros is worse than one that crashes.

## FortyGuard API

- **Never call the FortyGuard API without going through `app/services/cache.py`.**
  Quota is limited (possibly 30 heatmaps/day). The cache is load-bearing, not an
  optimisation. Never call twice for identical params.
- Vendored client lives in `backend/vendor/fortyguard/` — copied from the quickstart,
  MIT licensed, do not edit.
- Auth is an `api-key` header, not `Authorization: Bearer`.
- Calls are task-based: submit → poll status. `create_heatmap(..., wait=True)` returns
  `{"activity_id": ..., "result": {...}}`; the payload is under `["result"]`.

## Units — read this twice

- **Units are CELSIUS everywhere.** The vendored client's docstring claims tcm tiles are
  Fahrenheit — **it is WRONG**, verified against live data.
- `cloud_cover_octas` from `env_params` is actually **PERCENT 0–100**, despite the name.
- Any function taking or returning a temperature has the unit in its name or type
  (`temps_c`, `ambient_temp_c`, `FloatArray  # celsius`). Ambiguous temperature units are
  the single most likely way this project produces confidently wrong output.

## Discipline

- No secrets in code, ever. `.env` only. `.env` is gitignored; `.env.example` is the template.
- Structured logging via `logging`, never `print()`. Every FortyGuard call logs its `activity_id`.
- Seed all randomness explicitly. Demo results must be reproducible.
- Pin every dependency to a minor version. No floating ranges.
- Run `ruff check` and `pytest` before declaring any task done.
- **When unsure about physics or a formula, STOP and ask. Do not guess and move on.**
