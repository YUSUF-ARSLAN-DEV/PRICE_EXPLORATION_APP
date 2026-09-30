"""Data-accuracy audit (plan 10.2): compare prices a human saw on the shelf / on the retailer's own
site against what Qarib publishes.

Input: a CSV filled in by the field team (see examples/qa-audit-template.csv):
    retailer_slug, sku, observed_price, observed_on[, observer][, note]

Each row is classified:
    exact    published price equals the observed price (to the fils)
    close    within `tolerance` (default 5 %) but not exact
    wrong    differs by more than the tolerance
    stale    our price was last confirmed BEFORE the observation day by more than `stale_days`
             (a freshness problem, reported separately, excluded from the accuracy score)
    missing  the retailer/sku pair is not in the catalogue, or has no current price

accuracy = (exact + close) / (exact + close + wrong + missing). The launch gate (plan 10.2) is
>= 95 % over >= 300 rows across >= 3 retailers; `passes_gate` encodes exactly that.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

from .db import Conn

GATE_MIN_ACCURACY = Decimal("0.95")
GATE_MIN_ROWS = 300
GATE_MIN_RETAILERS = 3
REQUIRED = ("retailer_slug", "sku", "observed_price", "observed_on")


class AuditInputError(ValueError):
    """The audit CSV itself is malformed (never silently skipped: a bad audit proves nothing)."""


@dataclass(frozen=True)
class Observation:
    retailer_slug: str
    sku: str
    observed_price: Decimal
    observed_on: date
    observer: str = ""
    note: str = ""


@dataclass
class Finding:
    obs: Observation
    verdict: str
    published_price: Decimal | None = None
    diff_pct: Decimal | None = None


@dataclass
class AuditReport:
    findings: list[Finding] = field(default_factory=list)

    def counts(self, retailer: str | None = None) -> dict[str, int]:
        out = dict.fromkeys(("exact", "close", "wrong", "stale", "missing"), 0)
        for f in self.findings:
            if retailer is None or f.obs.retailer_slug == retailer:
                out[f.verdict] += 1
        return out

    @staticmethod
    def _accuracy(c: dict[str, int]) -> Decimal | None:
        denom = c["exact"] + c["close"] + c["wrong"] + c["missing"]
        return None if denom == 0 else Decimal(c["exact"] + c["close"]) / Decimal(denom)

    @property
    def accuracy(self) -> Decimal | None:
        return self._accuracy(self.counts())

    @property
    def retailers(self) -> list[str]:
        return sorted({f.obs.retailer_slug for f in self.findings})

    @property
    def passes_gate(self) -> bool:
        acc = self.accuracy
        return (
            acc is not None
            and acc >= GATE_MIN_ACCURACY
            and len(self.findings) >= GATE_MIN_ROWS
            and len(self.retailers) >= GATE_MIN_RETAILERS
        )

    def markdown(self) -> str:
        acc = self.accuracy
        acc_txt = "n/a" if acc is None else f"{acc * 100:.1f} %"
        lines = [
            "# Qarib data-accuracy audit",
            "",
            f"- rows audited: **{len(self.findings)}** across **{len(self.retailers)}** retailers",
            f"- accuracy: **{acc_txt}** "
            f"(gate: >= {GATE_MIN_ACCURACY * 100:.0f} % over >= {GATE_MIN_ROWS} rows, "
            f">= {GATE_MIN_RETAILERS} retailers)",
            f"- launch gate: **{'PASS' if self.passes_gate else 'NOT MET'}**",
            "",
            "| retailer | rows | exact | close | wrong | stale | missing | accuracy |",
            "|---|---:|---:|---:|---:|---:|---:|---:|",
        ]
        for r in self.retailers:
            c = self.counts(r)
            a = self._accuracy(c)
            a_txt = "n/a" if a is None else f"{a * 100:.1f} %"
            lines.append(
                f"| {r} | {sum(c.values())} | {c['exact']} | {c['close']} | {c['wrong']} | "
                f"{c['stale']} | {c['missing']} | {a_txt} |"
            )
        bad = [f for f in self.findings if f.verdict in ("wrong", "missing", "stale")]
        if bad:
            lines += ["", "## Discrepancies to investigate", ""]
            for f in bad:
                pub = "-" if f.published_price is None else f"{f.published_price}"
                lines.append(
                    f"- `{f.obs.retailer_slug}` / `{f.obs.sku}`: observed {f.obs.observed_price} "
                    f"on {f.obs.observed_on}, published {pub} -> **{f.verdict}**"
                    + (f" ({f.obs.note})" if f.obs.note else "")
                )
        return "\n".join(lines) + "\n"


def read_observations(path: Path) -> list[Observation]:
    with path.open(encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        missing = [c for c in REQUIRED if c not in (reader.fieldnames or [])]
        if missing:
            raise AuditInputError(f"audit CSV is missing columns: {', '.join(missing)}")
        out: list[Observation] = []
        for n, row in enumerate(reader, start=2):
            try:
                price = Decimal(str(row["observed_price"]).strip())
                if price <= 0:
                    raise InvalidOperation
                obs = Observation(
                    retailer_slug=row["retailer_slug"].strip(),
                    sku=row["sku"].strip(),
                    observed_price=price,
                    observed_on=datetime.strptime(row["observed_on"].strip(), "%Y-%m-%d").date(),
                    observer=(row.get("observer") or "").strip(),
                    note=(row.get("note") or "").strip(),
                )
            except (InvalidOperation, ValueError, AttributeError) as exc:
                raise AuditInputError(f"row {n}: invalid price or date ({exc})") from exc
            if not obs.retailer_slug or not obs.sku:
                raise AuditInputError(f"row {n}: retailer_slug and sku are required")
            out.append(obs)
    if not out:
        raise AuditInputError("audit CSV has no rows")
    return out


def classify(
    obs: Observation,
    published: Decimal | None,
    confirmed_on: date | None,
    *,
    tolerance: Decimal = Decimal("0.05"),
    stale_days: int = 2,
) -> Finding:
    if published is None:
        return Finding(obs, "missing")
    if confirmed_on is not None and (obs.observed_on - confirmed_on).days > stale_days:
        return Finding(obs, "stale", published)
    diff = (published - obs.observed_price) / obs.observed_price
    if published == obs.observed_price:
        return Finding(obs, "exact", published, Decimal(0))
    return Finding(obs, "close" if abs(diff) <= tolerance else "wrong", published, diff)


def audit(
    conn: Conn,
    observations: list[Observation],
    *,
    tolerance: Decimal = Decimal("0.05"),
    stale_days: int = 2,
) -> AuditReport:
    report = AuditReport()
    for o in observations:
        row: dict[str, Any] | None = conn.execute(
            """select cp.price_qar, cp.observed_at::date as confirmed_on
                 from retailer_products rp
                 join retailers r on r.id = rp.retailer_id
                 join current_prices cp on cp.retailer_product_id = rp.id
                where r.slug = %s and rp.external_sku = %s
                order by cp.observed_at desc limit 1""",
            (o.retailer_slug, o.sku),
        ).fetchone()
        published = None if row is None else Decimal(row["price_qar"])
        confirmed = None if row is None else row["confirmed_on"]
        report.findings.append(
            classify(o, published, confirmed, tolerance=tolerance, stale_days=stale_days)
        )
    return report
