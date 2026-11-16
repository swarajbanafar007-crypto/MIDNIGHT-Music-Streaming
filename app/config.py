"""Small local configuration loader for the desktop app."""

from __future__ import annotations

import os
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent.parent


def load_local_env() -> None:
    """Read simple KEY=value entries from the project's ignored .env file."""
    env_file = PROJECT_ROOT / ".env"
    if not env_file.exists():
        return

    for raw_line in env_file.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and value:
            os.environ.setdefault(key, value)


def youtube_api_key() -> str:
    load_local_env()
    return os.environ.get("YOUTUBE_API_KEY", "").strip()
