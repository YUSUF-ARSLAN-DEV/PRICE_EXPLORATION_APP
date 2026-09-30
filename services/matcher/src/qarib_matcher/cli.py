"""qarib-match <command>

sync-brands              load the starter brand dictionary into the database
run [--limit N]          match all unmatched listings
embed                    backfill product embeddings (needs the `embeddings` extra)
gold                     evaluate the gold set and print precision/recall
"""

import argparse
import json
import logging
from pathlib import Path

from qarib_ingest.config import Settings
from qarib_ingest.db import connect

from .engine import backfill_embeddings, build_context, run_matching, sync_brand_dictionary
from .gold import evaluate


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="qarib-match")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("sync-brands")
    run = sub.add_parser("run")
    run.add_argument("--limit", type=int, default=1000)
    run.add_argument(
        "--llm", action="store_true", help="enable LLM tie-break (needs ANTHROPIC_API_KEY)"
    )
    run.add_argument("--embeddings", action="store_true", help="use the multilingual embedder")
    sub.add_parser("embed")
    gold = sub.add_parser("gold")
    gold.add_argument("--file", type=Path, default=None)
    args = parser.parse_args(argv)
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )

    if args.cmd == "gold":
        metrics = evaluate(args.file)
        print(json.dumps(metrics, indent=2))
        return 0

    settings = Settings.from_env()
    with connect(settings.database_url) as conn:
        if args.cmd == "sync-brands":
            print(f"{sync_brand_dictionary(conn)} aliases synced")
        elif args.cmd == "embed":
            from .embed import SentenceTransformerEmbedder

            print(f"{backfill_embeddings(conn, SentenceTransformerEmbedder())} embeddings written")
        elif args.cmd == "run":
            embedder = adjudicator = None
            if args.embeddings:
                from .embed import SentenceTransformerEmbedder

                embedder = SentenceTransformerEmbedder()
            if args.llm:
                from .embed import AnthropicAdjudicator

                adjudicator = AnthropicAdjudicator()
            ctx = build_context(conn, embedder, adjudicator)
            print(run_matching(conn, ctx, limit=args.limit))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
