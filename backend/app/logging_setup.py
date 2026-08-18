import logging
import os

_FORMAT = "%(asctime)s %(levelname)s %(name)s %(message)s"


# structured logs, never print(). call once at app start.
def configure_logging() -> None:
    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO").upper(),
        format=_FORMAT,
        force=True,
    )
