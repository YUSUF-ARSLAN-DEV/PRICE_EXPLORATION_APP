"""Throw-away Postgres with the real migrations (skips without a DB unless REQUIRE_DB=1)."""

import os
import re
import uuid
from collections.abc import Iterator
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import psycopg
import pytest
from qarib_ingest.config import DEFAULT_DATABASE_URL
from qarib_ingest.db import Conn, connect

MIGRATIONS = Path(__file__).resolve().parents[3] / "packages" / "db" / "migrations"


def _up_sql(path: Path) -> str:
    raw = path.read_text(encoding="utf-8").replace("\r\n", "\n")
    before_down = re.split(r"^-- Down Migration\s*$", raw, flags=re.M)[0]
    return re.sub(r"^-- Up Migration\s*$", "", before_down, flags=re.M)


@pytest.fixture(scope="session")
def pg_url() -> Iterator[str]:
    base = os.environ.get("DATABASE_URL", DEFAULT_DATABASE_URL)
    try:
        admin = psycopg.connect(base, autocommit=True, connect_timeout=3)
    except psycopg.OperationalError as exc:
        if os.environ.get("REQUIRE_DB") == "1":
            raise
        pytest.skip(f"no database reachable ({exc}); run `pnpm up`")
    name = f"qarib_pymatch_{uuid.uuid4().hex[:8]}"
    admin.execute(f"create database {name}")  # noqa: S608
    url = urlunsplit(urlsplit(base)._replace(path=f"/{name}"))
    try:
        with psycopg.connect(url, autocommit=True) as c:
            for f in sorted(MIGRATIONS.glob("[0-9][0-9][0-9][0-9]_*.sql")):
                c.execute(_up_sql(f))  # type: ignore[arg-type,unused-ignore]
        yield url
    finally:
        admin.execute(f"drop database if exists {name} with (force)")
        admin.close()


@pytest.fixture
def conn(pg_url: str) -> Iterator[Conn]:
    c = connect(pg_url)
    try:
        yield c
    finally:
        c.rollback()
        c.close()
