"""Pure numpy physics. Never imports fastapi, pydantic, or app. Celsius everywhere."""

from typing import Any

import numpy as np

# every array in here is float64. named so strict mypy has something to hold.
FloatArray = np.ndarray[Any, np.dtype[np.float64]]

__all__ = ["FloatArray"]
