"""Command line entry point:  qarib-ingest <command>

run-feed --source-id UUID --file PATH [--format csv|json]   ingest a partner feed file
maintenance                                                 partitions, retention purges
health                                                      per-source health table
"""

import argparse
import logging
import sys
from decimal import Decimal
from pathlib import Path

from .adapters.feed import CsvFeedAdapter, JsonFeedAdapter
from .batch import SourceNotApproved, run_source
from .config import Settings
from .db import connect
from .maintenance import run_maintenance
from .qa import AuditInputError, audit, read_observations
from .store import make_store


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="qarib-ingest")
    sub = parser.add_subparsers(dest="cmd", required=True)
    feed = sub.add_parser("run-feed")
    feed.add_argument("--source-id", required=True)
    feed.add_argument("--file", required=True, type=Path)
    feed.add_argument("--format", choices=["csv", "json"])
    sub.add_parser("maintenance")
    sub.add_parser("health")
    qa = sub.add_parser("qa-audit", help="compare field-team observations with published prices")
    qa.add_argument("--file", required=True, type=Path)
    qa.add_argument("--tolerance", type=float, default=0.05)
    qa.add_argument("--report", type=Path, help="write the markdown report here")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    settings = Settings.from_env()
    store = make_store(
        settings.azure_connection_string,
        settings.azure_container,
        settings.artefact_dir,
        settings.azure_account_url,
    )

    with connect(settings.database_url) as conn:
        if args.cmd == "run-feed":
            fmt = args.format or args.file.suffix.lstrip(".").lower()
            cls = {"csv": CsvFeedAdapter, "json": JsonFeedAdapter}.get(fmt)
            if cls is None:
                print(f"cannot infer feed format from {args.file}; use --format", file=sys.stderr)
                return 2
            try:
                result = run_source(conn, cls(args.source_id, path=args.file), store, settings)
            except SourceNotApproved as exc:
                print(f"REFUSED: {exc}", file=sys.stderr)
                return 3
            print(f"batch {result.batch_id}: {result.status} {result.stats.as_json()}")
            if result.error:
                print(f"error: {result.error}", file=sys.stderr)
            return 0 if result.status == "succeeded" else 1
        if args.cmd == "maintenance":
            print(run_maintenance(conn, store))
            return 0
        if args.cmd == "qa-audit":
            try:
                report = audit(
                    conn, read_observations(args.file), tolerance=Decimal(str(args.tolerance))
                )
            except AuditInputError as exc:
                print(f"INVALID AUDIT FILE: {exc}", file=sys.stderr)
                return 2
            text = report.markdown()
            if args.report:
                args.report.write_text(text, encoding="utf-8")
            print(text)
            return 0 if report.passes_gate else 1
        if args.cmd == "health":
            for row in conn.execute("select * from source_health order by retailer_slug"):
                print(dict(row))
            return 0
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
