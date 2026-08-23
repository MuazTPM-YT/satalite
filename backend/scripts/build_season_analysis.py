"""TASK 7 - replay the cached strided season and write the json the route serves.

Run:  cd backend && .venv/bin/python -m scripts.build_season_analysis

Reads only the cache. Never calls the API - scripts/fetch_season_stride.py does that,
and a missing day here is an error rather than a gap to skip, because a season statistic
computed over "whatever happened to be cached" reads like a full summer.
"""

import logging
import time

from app.services.season import DOWNTOWN_PHOENIX, season_records, write_season_analysis
from scripts.fetch_season_stride import END_DATE, START_DATE, stride_days


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s: %(message)s")

    days = stride_days()
    records = season_records(DOWNTOWN_PHOENIX, START_DATE, END_DATE, days=days)
    print(f"{len(records)} records, {records[0]['date']}..{records[-1]['date']}")

    started = time.perf_counter()
    path = write_season_analysis(records)
    print(f"wrote {path} in {time.perf_counter() - started:.1f} s")


# the pool uses a non-fork start method, which re-imports this module in every worker.
# without the guard the workers re-run main() and the build deadlocks instead of failing.
if __name__ == "__main__":
    main()
