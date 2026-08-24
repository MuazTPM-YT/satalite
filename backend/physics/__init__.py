"""Pure numpy physics. Never imports fastapi, pydantic, or app. Celsius everywhere."""

from typing import Any

import numpy as np

# every array in here is float64. named so strict mypy has something to hold.
FloatArray = np.ndarray[Any, np.dtype[np.float64]]

# cell indices. probe stencils carry them around in pairs.
IntArray = np.ndarray[Any, np.dtype[np.int64]]

# the solid mask, and anything else that is one bool per cell.
BoolArray = np.ndarray[Any, np.dtype[np.bool_]]

# the per-cell face tags. one uint8 of EXPOSED/FORMED/GROUND/ADIABATIC bits.
TagArray = np.ndarray[Any, np.dtype[np.uint8]]

# scalar or array. most equations take either.
Floats = FloatArray | float

__all__ = ["BoolArray", "FloatArray", "Floats", "IntArray", "TagArray"]
