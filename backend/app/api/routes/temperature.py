from fastapi import APIRouter

from app.models import TemperatureRequest, TemperatureSeries

router = APIRouter(prefix="/temperature", tags=["temperature"])


# air temp for a site. goes through cache.py, never straight to the api.
@router.post("", response_model=TemperatureSeries)
async def get_temperature(request: TemperatureRequest) -> TemperatureSeries:
    raise NotImplementedError
