"""Thin psycopg helpers."""

from typing import Any

import psycopg
from psycopg.rows import dict_row

Conn = psycopg.Connection[dict[str, Any]]


def connect(url: str) -> Conn:
    return psycopg.connect(url, row_factory=dict_row)
