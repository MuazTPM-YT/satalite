"""TASK 7 - fetch a strided summer sample of downtown Phoenix, resumably.

Every 3rd day of 2025-06-01..2025-08-31, anchored so the already-cached 2025-07-15 falls
on the grid. 30 days, 29 of them new, 122,380 credits. The full 92-day season would be
388,240 - a summer breach fraction does not need consecutive days, and quota is the
binding constraint on this project.

Run:  cd backend && .venv/bin/python -m scripts.fetch_season_stride

fetch_season stops at max_calls_per_run and checkpoints after every cached day, so this
takes two runs and a kill between them costs nothing. Rerun until it prints COMPLETE.
"""

import logging
from datetime import date, timedelta

from app.config import get_settings
from app.services.cache import is_cached
from app.services.season import (
    CREDITS_PER_CALL,
    DOWNTOWN_PHOENIX,
    check_credits,
    day_params,
    fetch_season,
    season_records,
)

START_DATE = "2025-06-01"
END_DATE = "2025-08-31"
STRIDE_DAYS = 3

# the cached day the grid is anchored on. It is committed to the repo, so landing the
# grid on it saves a call AND keeps the one day whose parsing is covered by tests.
ANCHOR = "2025-07-15"


# every STRIDE_DAYS-th day in the range, phased so ANCHOR is one of them.
def stride_days() -> list[str]:
    start, end = date.fromisoformat(START_DATE), date.fromisoformat(END_DATE)
    offset = (date.fromisoformat(ANCHOR) - start).days % STRIDE_DAYS
    days = [
        (start + timedelta(days=n)).isoformat()
        for n in range(offset, (end - start).days + 1, STRIDE_DAYS)
    ]
    if ANCHOR not in days:
        raise AssertionError(f"{ANCHOR} is not on the stride grid - the phasing is wrong")
    return days


def main() -> None:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    settings = get_settings()
    days = stride_days()
    pending = [
        d for d in days
        if not is_cached(settings.cache_dir, "heatmap", day_params(DOWNTOWN_PHOENIX, d))
    ]

    print(f"grid: {len(days)} days, {START_DATE}..{END_DATE} stride {STRIDE_DAYS}, "
          f"anchored on {ANCHOR}")
    print(f"cached: {len(days) - len(pending)}  pending: {len(pending)}  "
          f"cost to finish: {len(pending) * CREDITS_PER_CALL:,} credits")
    print(f"credits now: {check_credits(settings):,.0f}\n")

    fetch_season(DOWNTOWN_PHOENIX, START_DATE, END_DATE, days=days, settings=settings)

    still_pending = [
        d for d in days
        if not is_cached(settings.cache_dir, "heatmap", day_params(DOWNTOWN_PHOENIX, d))
    ]
    if still_pending:
        print(f"\nINCOMPLETE: {len(still_pending)} days left, first {still_pending[0]}. "
              "Rerun this script.")
        return

    print("\nCOMPLETE. all grid days cached.")
    records = season_records(DOWNTOWN_PHOENIX, START_DATE, END_DATE, settings, days=days)
    print(f"{len(records)} records parsed. first {records[0]['date']}, last {records[-1]['date']}")


if __name__ == "__main__":
    main()
