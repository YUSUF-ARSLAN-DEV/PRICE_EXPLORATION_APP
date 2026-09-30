import json
import socket
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path

import pytest

from qarib_ingest.adapters.feed import CsvFeedAdapter, JsonFeedAdapter, parse_rows
from qarib_ingest.config import Settings
from qarib_ingest.fetcher import PoliteFetcher
from qarib_ingest.store import AzureBlobArtifactStore, LocalArtifactStore

from .conftest import LocalServer

NOW = datetime(2026, 9, 30, 12, 0, tzinfo=UTC)
SID = "00000000-0000-0000-0000-000000000001"


# ---- stores -----------------------------------------------------------------------------------
def test_local_store_is_content_addressed_and_immutable(tmp_path: Path) -> None:
    store = LocalArtifactStore(tmp_path)
    a = store.put("src", "batch", "feed.csv", b"hello")
    b = store.put("src", "batch", "feed.csv", b"hello")
    assert a == b and a.size_bytes == 5 and len(a.sha256) == 64
    assert store.exists(a.uri)
    c = store.put("src", "batch", "feed.csv", b"different")
    assert c.uri != a.uri, "different content never overwrites"
    assert (tmp_path / "src" / "batch").exists()
    store.delete(a.uri)
    assert not store.exists(a.uri)
    store.delete(a.uri)  # idempotent


def test_local_store_sanitises_names(tmp_path: Path) -> None:
    store = LocalArtifactStore(tmp_path)
    art = store.put("s", "b", "../../etc/passwd", b"x")
    assert store._path(art.uri).resolve().is_relative_to(tmp_path.resolve())


def _azurite_up() -> bool:
    try:
        with socket.create_connection(("127.0.0.1", 10000), timeout=0.5):
            return True
    except OSError:
        return False


AZURITE = (
    "DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;"
    "AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;"
    "BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;"
)


@pytest.mark.skipif(not _azurite_up(), reason="Azurite not running (docker compose up azurite)")
def test_azure_blob_store_against_azurite() -> None:
    store = AzureBlobArtifactStore(AZURITE, "pytest-artefacts")
    a = store.put("src", "batch", "feed.csv", b"hello blob")
    assert store.put("src", "batch", "feed.csv", b"hello blob") == a
    assert store.exists(a.uri)
    store.delete(a.uri)
    assert not store.exists(a.uri)


# ---- feeds ------------------------------------------------------------------------------------
def test_parse_rows_aliases_decimals_and_defaults() -> None:
    res = parse_rows(
        SID,
        [
            {
                "SKU": "A1",
                "Product_Name": "Milk 1L",
                "Price": "6,50",
                "Was_Price": "7.25",
                "Size": "1L",
            },
            {
                "sku": "A2",
                "name": "Rice",
                "price_qar": "QAR 1,299.00",
                "gtin": "6281007000017",
                "observed_at": "2026-09-29T08:00:00Z",
                "branch": "Doha Main",
                "offer": "Buy 2 save 10%",
            },
        ],
        NOW,
    )
    assert not res.invalid
    a, b = res.offers
    assert a.price == Decimal("6.50") and a.was_price == Decimal("7.25") and a.observed_at == NOW
    assert a.size_text == "1L"
    assert b.price == Decimal("1299.00") and b.barcode == "6281007000017"
    assert b.observed_at == datetime(2026, 9, 29, 8, 0, tzinfo=UTC)
    assert b.branch_hint == "Doha Main" and b.promo_text == "Buy 2 save 10%"


@pytest.mark.parametrize(
    "row, fragment",
    [
        ({"sku": "A", "name": "x"}, "price"),
        ({"sku": "A", "price": "3"}, "name"),
        ({"name": "x", "price": "3"}, "external_sku"),
        ({"sku": "A", "name": "x", "price": "abc"}, "valid amount"),
        ({"sku": "A", "name": "x", "price": "-3"}, "price"),
        ({"sku": "A", "name": "x", "price": "3", "observed_at": "not a date"}, "Invalid isoformat"),
    ],
)
def test_parse_rows_rejects_bad_rows_with_a_reason(row: dict[str, str], fragment: str) -> None:
    res = parse_rows(SID, [row], NOW)
    assert not res.offers and len(res.invalid) == 1
    assert fragment in res.invalid[0][1]


def test_csv_adapter_reads_bom_and_arabic(tmp_path: Path) -> None:
    f = tmp_path / "feed.csv"
    f.write_bytes("﻿sku,name,price,size\nA1,حليب طازج,6.5,1 لتر\nA2,,3,1kg\n".encode())
    ad = CsvFeedAdapter(SID, path=f)
    res = ad.parse(ad.fetch())
    assert [o.name for o in res.offers] == ["حليب طازج"]
    assert len(res.invalid) == 1


def test_json_adapter_accepts_list_or_items_and_flags_non_objects(tmp_path: Path) -> None:
    f = tmp_path / "feed.json"
    f.write_text(json.dumps({"items": [{"sku": "1", "name": "a", "price": 2}, "oops"]}))
    ad = JsonFeedAdapter(SID, path=f)
    res = ad.parse(ad.fetch())
    assert len(res.offers) == 1 and len(res.invalid) == 1
    f.write_text(json.dumps([{"sku": "1", "name": "a", "price": 2.5}]))
    assert ad.parse(ad.fetch()).offers[0].price == Decimal("2.50")
    f.write_text(json.dumps({"nope": 1}))
    with pytest.raises(ValueError, match="items"):
        ad.parse(ad.fetch())


def test_adapter_constructor_validation(tmp_path: Path) -> None:
    with pytest.raises(ValueError):
        CsvFeedAdapter(SID)
    with pytest.raises(ValueError):
        CsvFeedAdapter(SID, path=tmp_path / "x", url="http://x")
    with pytest.raises(ValueError, match="PoliteFetcher"):
        CsvFeedAdapter(SID, url="http://x/feed.csv")


def test_url_feed_goes_through_the_polite_fetcher(server: LocalServer) -> None:
    server.add("/feed.csv", "sku,name,price\nA1,Milk,6.5\n", Content_Type="text/csv")
    fetcher = PoliteFetcher(Settings(min_interval_s=0, global_interval_s=0))
    ad = CsvFeedAdapter(
        SID, url=server.base + "/feed.csv", fetcher=fetcher, headers={"X-Api-Key": "k"}
    )
    res = ad.parse(ad.fetch())
    assert res.offers[0].name == "Milk"
    assert any(p == "/robots.txt" for p, _ in server.requests)
    assert server.requests[-1][1]["X-Api-Key"] == "k"
