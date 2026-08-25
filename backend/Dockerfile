# BUILD CONTEXT IS THE REPO ROOT, not backend/:
#     docker build -f backend/Dockerfile -t satalite .
# docs/ holds the validation report the /api/validation route serves, and it lives
# outside backend/, so a backend-rooted context cannot see it at all.

# ---------------------------------------------------------------------------
# builder - has uv and the toolchain, and none of it reaches the final image
# ---------------------------------------------------------------------------
FROM python:3.12-slim AS builder

COPY --from=ghcr.io/astral-sh/uv:0.11.29 /uv /uvx /bin/

WORKDIR /app

# UV_NO_CACHE: uv's download cache is wheels that are already unpacked into .venv.
# Keeping it buys nothing at runtime and every cold start pays to pull it.
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_NO_CACHE=1

# deps first so code edits do not bust the layer
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev

COPY backend/ ./
COPY docs/ ./docs/
RUN uv sync --frozen --no-dev

# ---------------------------------------------------------------------------
# runtime - the venv and the app, no uv, no build tooling
# ---------------------------------------------------------------------------
# Measured on this project: single stage 970 MB, +UV_NO_CACHE 672 MB, this 578 MB.
# Size is not vanity here - it is what a scale-to-zero host pulls on every cold start.
# 578 MB is the floor without surgery: scipy is 152 MB and numpy 67 MB of the 260 MB
# venv, and physics/uncertainty.py imports scipy.stats at module scope, so neither can
# be dropped without dropping the ensemble.
FROM python:3.12-slim

WORKDIR /app

COPY --from=builder /app /app

# the venv is on PATH instead of being run through `uv run`, so uv itself never has to
# ship. Same interpreter, one less binary and one less process in the container.
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1

# the image flattens the repo layout, so the settings defaults - which are derived by
# walking up from __file__ - point at directories that do not exist here. Name both
# paths absolutely instead of letting the walk guess.
ENV CACHE_DIR=/app/data/cache \
    VALIDATION_PATH=/app/docs/VALIDATION.json

# ALLOWED_ORIGINS must name the deployed frontend origin. The default is localhost only,
# which passes every test and then fails every browser request in production.
#     -e ALLOWED_ORIGINS=https://satalite.example.com

# Cloud Run, Fly and most container hosts inject the port they want the app on and
# health-check that port only - a container that hardcodes one is marked unhealthy and
# rolled back with no useful error. Default 8000 so `docker run -p 8000:8000` is
# unchanged; PORT overrides it. Shell form on purpose: exec form does not expand ${PORT}.
ENV PORT=8000
EXPOSE 8000

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
