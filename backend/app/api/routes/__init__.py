"""Route modules. Wired into the app."""

from fastapi import APIRouter

from app.api.routes import analysis, heatmap, simulate, temperature

api_router = APIRouter(prefix="/api")
api_router.include_router(temperature.router)
api_router.include_router(simulate.router)
api_router.include_router(analysis.router)
api_router.include_router(heatmap.router)

__all__ = ["api_router"]
