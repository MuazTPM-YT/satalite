import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.api.routes import api_router
from app.config import get_settings
from app.logging_setup import configure_logging
from app.models import HealthResponse

log = logging.getLogger(__name__)


# build the app. reads settings now so a missing api key kills startup, not a request.
def create_app() -> FastAPI:
    configure_logging()
    settings = get_settings()
    log.info(
        "satalite %s starting, cache_dir=%s origins=%s",
        __version__,
        settings.cache_dir,
        settings.cors_origins,
    )

    app = FastAPI(title="SatAlite", version=__version__)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(api_router)

    # is it alive
    @app.get("/api/health", response_model=HealthResponse)
    async def health() -> HealthResponse:
        return HealthResponse(status="ok", version=__version__)

    return app


app = create_app()
