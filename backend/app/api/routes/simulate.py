from fastapi import APIRouter

from app.models import SimulationRequest, SimulationResult

router = APIRouter(prefix="/simulate", tags=["simulate"])


# run the cure. physics does the work, this only marshals.
@router.post("", response_model=SimulationResult)
async def simulate(request: SimulationRequest) -> SimulationResult:
    raise NotImplementedError
