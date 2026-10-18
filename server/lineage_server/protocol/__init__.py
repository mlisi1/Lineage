"""The state stream's wire format: `schema.json` defines it, `encode` builds its messages."""

from pathlib import Path

SCHEMA_PATH = Path(__file__).with_name("schema.json")
