"""Route modules. Wired into the app, no logic yet."""

from fastapi import APIRouter

from app.api.routes import simulate, temperature

api_router = APIRouter(prefix="/api")
api_router.include_router(temperature.router)
api_router.include_router(simulate.router)

__all__ = ["api_router"]
