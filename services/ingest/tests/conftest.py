"""Shared fixtures: a throw-away Postgres database with the real migrations applied, and a tiny
local HTTP server for fetcher tests (no test ever touches the public internet).

DB tests skip when no server is reachable, unless REQUIRE_DB=1 (CI), where they fail instead.
"""

import os
import re
import threading
import uuid
from collections.abc import Iterator
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import psycopg
import pytest

from qarib_ingest.config import DEFAULT_DATABASE_URL, Settings
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
    name = f"qarib_pytest_{uuid.uuid4().hex[:8]}"
    admin.execute(f"create database {name}")  # noqa: S608 - name is generated here
    parts = urlsplit(base)
    url = urlunsplit(parts._replace(path=f"/{name}"))
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


@pytest.fixture
def settings(pg_url: str, tmp_path: Path) -> Settings:
    return Settings(
        database_url=pg_url,
        min_interval_s=0.0,
        global_interval_s=0.0,
        artefact_dir=tmp_path / "artefacts",
    )


@dataclass
class Seeded:
    retailer_id: str
    source_id: str


def make_source(
    conn: Conn, method: str = "partner_feed", status: str = "green", approval: str | None = "test"
) -> Seeded:
    slug = "t-" + uuid.uuid4().hex[:8]
    r = conn.execute(
        "insert into retailers (slug, name_en, type) values (%s, %s, 'supermarket') returning id",
        (slug, slug),
    ).fetchone()
    assert r is not None
    s = conn.execute(
        "insert into sources (retailer_id, method, legal_status, approval_ref) "
        "values (%s, %s::source_method, %s::legal_status, %s) returning id",
        (r["id"], method, status, approval),
    ).fetchone()
    assert s is not None
    conn.commit()
    return Seeded(str(r["id"]), str(s["id"]))


# ---- local HTTP server -------------------------------------------------------------------------
@dataclass
class LocalServer:
    base: str
    routes: dict[str, tuple[int, dict[str, str], bytes]] = field(default_factory=dict)
    requests: list[tuple[str, dict[str, str]]] = field(default_factory=list)

    def add(self, path: str, body: bytes | str = b"", status: int = 200, **headers: str) -> None:
        data = body.encode() if isinstance(body, str) else body
        self.routes[path] = (status, {k.replace("_", "-"): v for k, v in headers.items()}, data)

    def hits(self, path: str) -> int:
        return sum(1 for p, _ in self.requests if p == path)


@pytest.fixture
def server() -> Iterator[LocalServer]:
    srv_holder: dict[str, Any] = {}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            s: LocalServer = srv_holder["state"]
            s.requests.append((self.path, {k: v for k, v in self.headers.items()}))
            status, headers, body = s.routes.get(self.path, (404, {}, b"not found"))
            self.send_response(status)
            headers = {"Content-Type": "text/plain", **headers}
            for k, v in headers.items():
                self.send_header(k, v)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args: Any) -> None:
            pass

    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    state = LocalServer(base=f"http://127.0.0.1:{httpd.server_address[1]}")
    srv_holder["state"] = state
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield state
    finally:
        httpd.shutdown()
        httpd.server_close()
