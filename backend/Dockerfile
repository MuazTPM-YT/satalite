FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.11.29 /uv /uvx /bin/

WORKDIR /app

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONUNBUFFERED=1

# BUILD CONTEXT IS THE REPO ROOT, not backend/:
#     docker build -f backend/Dockerfile -t satalite .
# docs/ holds the validation report the /api/validation route serves, and it lives
# outside backend/, so a backend-rooted context cannot see it at all.

# deps first so code edits do not bust the layer
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev

COPY backend/ ./
COPY docs/ ./docs/
RUN uv sync --frozen --no-dev

# the image flattens the repo layout, so the settings defaults - which are derived by
# walking up from __file__ - point at directories that do not exist here. Name both
# paths absolutely instead of letting the walk guess.
ENV CACHE_DIR=/app/data/cache \
    VALIDATION_PATH=/app/docs/VALIDATION.json

# ALLOWED_ORIGINS must name the deployed frontend origin. The default is localhost only,
# which passes every test and then fails every browser request in production.
#     -e ALLOWED_ORIGINS=https://satalite.example.com

EXPOSE 8000

CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
