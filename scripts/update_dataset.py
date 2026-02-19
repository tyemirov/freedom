#!/usr/bin/env python3
"""
Update `full_states_dataset.json` from documented, reproducible transforms.

This repo's dataset is intentionally a "starter proxy" dataset: a structure that
can accept real, primary-source action friction over time, but is currently
seeded from synthesized proxies.

This script keeps the methodology explicit and auditable by:
- Crawling Tax Foundation's combined state + avg local sales tax rates (Jan 2025)
  and caching the raw mapping under `sources/`.
- Rescaling housing build timelines so long approval queues do not clip at the
  global default normalization max (180 days).
- Expanding the action library with deterministic, documented proxy actions so
  domains are not single-point measurements.

The scoring logic lives in `script.js` and consumes these fields:
- action: permission_count, median_days, penalty_severity (0..1)
- optional: weight, days_max, permission_max, source
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.request
from dataclasses import dataclass
from datetime import date
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Optional


DEFAULT_DATASET_PATH = Path("full_states_dataset.json")

DEFAULT_SALES_TAX_URL = "https://taxfoundation.org/data/all/state/sales-tax-rates/"
DEFAULT_SALES_TAX_TABLE_ID = "tablepress-796"  # 2025 Sales Tax Rates by State (Jan 2025)
DEFAULT_SALES_TAX_EFFECTIVE_DATE = "2025-01"
DEFAULT_SALES_TAX_CACHE_PATH = Path("sources/taxfoundation_sales_tax_rates_2025-01.json")

DEFAULT_HOUSING_BUY_DAYS_MAX = 420
DEFAULT_HOUSING_BUY_PERMISSION_MAX = 12


def clamp_int(value: float, minimum: int, maximum: int) -> int:
    return int(max(minimum, min(maximum, int(round(value)))))


def clamp_float(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, float(value)))


def pct_text_to_decimal(pct_text: str) -> float:
    # e.g. "9.427%" -> 0.09427
    text = pct_text.strip().replace("%", "")
    if not text:
        raise ValueError("empty percent value")
    return float(text) / 100.0


def canonical_state_name(raw_name: str) -> str:
    # Strip footnotes like "California (a)".
    name = raw_name.strip()
    name = re.sub(r"\s*\([^)]*\)\s*$", "", name)
    return name


class HtmlTableParser(HTMLParser):
    def __init__(self, table_id: str) -> None:
        super().__init__(convert_charrefs=True)
        self._table_id = table_id

        self._in_table = False
        self._table_depth = 0
        self._in_tbody = False
        self._in_row = False
        self._in_cell = False

        self._cell_parts: list[str] = []
        self._row_cells: list[str] = []
        self.rows: list[list[str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, Optional[str]]]) -> None:
        attrs_dict = {k: v for k, v in attrs}

        if tag == "table" and attrs_dict.get("id") == self._table_id:
            self._in_table = True
            self._table_depth = 1
            return

        if self._in_table and tag == "table":
            self._table_depth += 1

        if not self._in_table:
            return

        if tag == "tbody":
            self._in_tbody = True
            return

        if tag == "tr":
            self._in_row = True
            self._row_cells = []
            return

        if tag in ("td", "th"):
            self._in_cell = True
            self._cell_parts = []
            return

    def handle_endtag(self, tag: str) -> None:
        if not self._in_table:
            return

        if tag in ("td", "th") and self._in_cell:
            cell_text = " ".join(part.strip() for part in self._cell_parts).strip()
            cell_text = re.sub(r"\s+", " ", cell_text)
            self._row_cells.append(cell_text)
            self._in_cell = False
            self._cell_parts = []
            return

        if tag == "tr" and self._in_row:
            if self._in_tbody and self._row_cells:
                self.rows.append(self._row_cells)
            self._in_row = False
            self._row_cells = []
            return

        if tag == "tbody":
            self._in_tbody = False
            return

        if tag == "table":
            self._table_depth -= 1
            if self._table_depth <= 0:
                self._in_table = False
                self._table_depth = 0
            return

    def handle_data(self, data: str) -> None:
        if self._in_table and self._in_cell:
            self._cell_parts.append(data)


@dataclass(frozen=True)
class SalesTaxSource:
    url: str
    table_id: str
    effective_date: str
    retrieved_at: str


def fetch_taxfoundation_sales_tax_rates(
    *,
    url: str,
    table_id: str,
) -> dict[str, float]:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "freedom-dataset-updater/1.0"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        html = response.read().decode("utf-8", errors="replace")

    parser = HtmlTableParser(table_id)
    parser.feed(html)

    rates: dict[str, float] = {}
    for row in parser.rows:
        # Expected columns:
        # 0 State, 1 State Rate, 2 Rank, 3 Avg Local, 4 Max Local, 5 Combined, 6 Combined Rank
        if len(row) < 6:
            continue
        state = canonical_state_name(row[0])
        combined_text = row[5]
        try:
            rates[state] = pct_text_to_decimal(combined_text)
        except Exception:
            continue

    if not rates:
        raise RuntimeError(f"No rows parsed from sales tax table id={table_id}")

    return rates


def load_json(path: Path) -> Any:
    return json.loads(path.read_text())


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n")


def set_if_changed(container: dict[str, Any], key: str, value: Any) -> bool:
    if container.get(key) == value:
        return False
    container[key] = value
    return True


def find_action(actions: list[dict[str, Any]], name: str) -> Optional[dict[str, Any]]:
    for action in actions:
        if action.get("name") == name:
            return action
    return None


def upsert_action(actions: list[dict[str, Any]], action: dict[str, Any]) -> bool:
    existing = find_action(actions, str(action.get("name", "")))
    if existing is None:
        actions.append(action)
        return True

    changed = False
    for key, value in action.items():
        if existing.get(key) != value:
            existing[key] = value
            changed = True
    return changed


def normalize_action_numbers(action: dict[str, Any]) -> bool:
    changed = False

    if "permission_count" in action:
        value = int(action["permission_count"])
        changed |= set_if_changed(action, "permission_count", value)

    if "median_days" in action:
        value = int(action["median_days"])
        changed |= set_if_changed(action, "median_days", value)

    if "penalty_severity" in action:
        value = round(float(action["penalty_severity"]), 2)
        changed |= set_if_changed(action, "penalty_severity", value)

    if "weight" in action:
        value = round(float(action["weight"]), 3)
        changed |= set_if_changed(action, "weight", value)

    if "days_max" in action:
        value = int(action["days_max"])
        changed |= set_if_changed(action, "days_max", value)

    if "permission_max" in action:
        value = int(action["permission_max"])
        changed |= set_if_changed(action, "permission_max", value)

    return changed


def apply_v2_5_transforms(
    dataset: dict[str, Any],
    *,
    sales_tax_rates: dict[str, float],
    sales_tax_source: SalesTaxSource,
    housing_buy_days_max: int,
    housing_buy_permission_max: int,
) -> bool:
    dirty = False

    jurisdictions = dataset.get("jurisdictions")
    if not isinstance(jurisdictions, list):
        raise RuntimeError("Dataset missing jurisdictions[]")

    for jurisdiction in jurisdictions:
        name = jurisdiction.get("name")
        if not isinstance(name, str):
            raise RuntimeError("Jurisdiction missing name")

        tax = jurisdiction.setdefault("tax_proxies", {})
        if not isinstance(tax, dict):
            raise RuntimeError(f"Jurisdiction tax_proxies is not an object: {name}")

        # Update sales tax proxy from Tax Foundation combined rate.
        if name not in sales_tax_rates:
            raise RuntimeError(f"Missing sales tax rate for jurisdiction: {name}")
        dirty |= set_if_changed(tax, "sales_effective_rate", round(float(sales_tax_rates[name]), 5))

        domains = jurisdiction.get("domains") or {}
        if not isinstance(domains, dict):
            raise RuntimeError(f"Jurisdiction domains is not an object: {name}")

        # housing_rent: two actions, add weights + sources.
        rent_actions = (domains.get("housing_rent") or {}).get("actions") or []
        for action in rent_actions:
            if action.get("name") == "Short-term rental permit":
                dirty |= set_if_changed(action, "weight", 0.8)
            elif action.get("name") == "Eviction/Lease flexibility":
                dirty |= set_if_changed(action, "weight", 1.2)
            else:
                if "weight" not in action:
                    action["weight"] = 1.0
                    dirty = True
            dirty |= set_if_changed(action, "source", "proxy: housing/rent regulation")
            dirty |= normalize_action_numbers(action)

        # housing_buy: rescale time normalization + expand action list + weights + sources.
        buy_actions = (domains.get("housing_buy") or {}).get("actions") or []
        adu_action = find_action(buy_actions, "Build ADU / Expand")
        variance_action = find_action(buy_actions, "Zoning variance")

        for action in buy_actions:
            dirty |= set_if_changed(action, "days_max", housing_buy_days_max)
            dirty |= set_if_changed(action, "permission_max", housing_buy_permission_max)
            if action.get("name") == "Build ADU / Expand":
                dirty |= set_if_changed(action, "weight", 1.2)
            elif action.get("name") == "Zoning variance":
                dirty |= set_if_changed(action, "weight", 0.8)
            else:
                dirty |= set_if_changed(action, "weight", float(action.get("weight", 1.0)))
            dirty |= set_if_changed(action, "source", "proxy: land-use friction")
            dirty |= normalize_action_numbers(action)

        if isinstance(adu_action, dict):
            remodel_action = {
                "name": "Major remodel permit",
                "permission_count": clamp_int(float(adu_action.get("permission_count", 6)) * 0.75, 3, 10),
                "median_days": clamp_int(float(adu_action.get("median_days", 150)) * 0.6, 30, housing_buy_days_max),
                "penalty_severity": round(
                    clamp_float(float(adu_action.get("penalty_severity", 0.7)) - 0.1, 0.1, 1.0), 2
                ),
                "days_max": housing_buy_days_max,
                "permission_max": housing_buy_permission_max,
                "weight": 1.0,
                "source": "proxy: land-use friction",
            }

            if find_action(buy_actions, remodel_action["name"]) is None:
                insert_index = len(buy_actions)
                if isinstance(variance_action, dict):
                    insert_index = buy_actions.index(variance_action)
                buy_actions.insert(insert_index, remodel_action)
                dirty = True
            else:
                dirty |= upsert_action(buy_actions, remodel_action)

        # business: expand beyond Start LLC.
        business_actions = (domains.get("business") or {}).get("actions") or []
        llc_action = find_action(business_actions, "Start LLC")
        if isinstance(llc_action, dict):
            dirty |= set_if_changed(llc_action, "weight", 1.0)
            dirty |= set_if_changed(llc_action, "source", "proxy: business compliance")
            dirty |= normalize_action_numbers(llc_action)

            pc = int(llc_action.get("permission_count", 3))
            md = int(llc_action.get("median_days", 10))
            ps = float(llc_action.get("penalty_severity", 0.42))

            hire_action = {
                "name": "Hire first employee",
                "permission_count": clamp_int(pc + 2, 1, 10),
                "median_days": clamp_int(md + 7, 0, 60),
                "penalty_severity": round(clamp_float(ps + 0.08, 0.1, 1.0), 2),
                "weight": 1.0,
                "source": "proxy: labor/compliance",
            }
            contractor_action = {
                "name": "Contractor vs employee classification",
                "permission_count": clamp_int(max(1, pc - 1), 1, 10),
                "median_days": clamp_int(md * 0.3, 0, 30),
                "penalty_severity": round(clamp_float(ps + 0.12, 0.1, 1.0), 2),
                "weight": 0.8,
                "source": "proxy: labor/compliance",
            }

            dirty |= upsert_action(business_actions, hire_action)
            dirty |= upsert_action(business_actions, contractor_action)

        # school: break "Homeschool" into sub-actions.
        school_actions = (domains.get("school") or {}).get("actions") or []
        homeschool_action = find_action(school_actions, "Homeschool")
        if isinstance(homeschool_action, dict):
            dirty |= set_if_changed(homeschool_action, "weight", 1.0)
            dirty |= set_if_changed(homeschool_action, "source", "proxy: HSLDA tier")
            dirty |= normalize_action_numbers(homeschool_action)

            pc = int(homeschool_action.get("permission_count", 2))
            md = int(homeschool_action.get("median_days", 6))
            ps = float(homeschool_action.get("penalty_severity", 0.2))

            reporting_action = {
                "name": "Homeschool notice / reporting",
                "permission_count": clamp_int(max(1, pc - 1), 1, 6),
                "median_days": clamp_int(md * 0.5, 0, 30),
                "penalty_severity": round(clamp_float(ps * 0.8, 0.05, 1.0), 2),
                "weight": 0.8,
                "source": "proxy: HSLDA tier",
            }
            assessment_action = {
                "name": "Homeschool assessment / testing",
                "permission_count": clamp_int(pc + 1, 1, 8),
                "median_days": clamp_int((md * 0.8) + 2, 0, 45),
                "penalty_severity": round(clamp_float(ps + 0.1, 0.05, 1.0), 2),
                "weight": 0.7,
                "source": "proxy: HSLDA tier",
            }

            dirty |= upsert_action(school_actions, reporting_action)
            dirty |= upsert_action(school_actions, assessment_action)

        # speech: add common adjacent permits/restrictions.
        speech_actions = (domains.get("speech") or {}).get("actions") or []
        assembly_action = find_action(speech_actions, "Assembly Permit")
        if isinstance(assembly_action, dict):
            dirty |= set_if_changed(assembly_action, "weight", 1.0)
            dirty |= set_if_changed(assembly_action, "source", "proxy: civic regulation")
            dirty |= normalize_action_numbers(assembly_action)

            pc = int(assembly_action.get("permission_count", 2))
            md = int(assembly_action.get("median_days", 21))
            ps = float(assembly_action.get("penalty_severity", 0.56))

            sound_action = {
                "name": "Sound amplification permit",
                "permission_count": clamp_int(pc + 1, 1, 8),
                "median_days": clamp_int(md * 0.6, 0, 30),
                "penalty_severity": round(clamp_float(ps + 0.05, 0.1, 1.0), 2),
                "weight": 0.6,
                "source": "proxy: civic regulation",
            }
            signage_action = {
                "name": "Signage / leafleting restrictions",
                "permission_count": clamp_int(max(1, pc - 1), 1, 6),
                "median_days": 0,
                "penalty_severity": round(clamp_float(ps * 0.9, 0.1, 1.0), 2),
                "weight": 0.4,
                "source": "proxy: civic regulation",
            }

            dirty |= upsert_action(speech_actions, sound_action)
            dirty |= upsert_action(speech_actions, signage_action)

        # privacy: make time non-zero and add common compliance obligations.
        privacy_actions = (domains.get("privacy") or {}).get("actions") or []
        data_action = find_action(privacy_actions, "Data compliance")
        if isinstance(data_action, dict):
            dirty |= set_if_changed(data_action, "weight", 1.0)
            dirty |= set_if_changed(data_action, "source", "proxy: privacy compliance")

            # Convert "permission count" into a rough time burden (compliance lead time).
            pc = int(data_action.get("permission_count", 3))
            ps = float(data_action.get("penalty_severity", 0.6))
            dirty |= set_if_changed(data_action, "median_days", clamp_int(max(10, pc * 10), 0, 180))
            dirty |= normalize_action_numbers(data_action)

            consumer_action = {
                "name": "Consumer data requests",
                "permission_count": clamp_int(pc, 1, 10),
                "median_days": clamp_int(30 + (pc * 5), 0, 180),
                "penalty_severity": round(clamp_float(ps * 0.9, 0.1, 1.0), 2),
                "weight": 0.8,
                "source": "proxy: privacy compliance",
            }
            breach_action = {
                "name": "Breach notification / penalties",
                "permission_count": clamp_int(max(1, pc - 1), 1, 10),
                "median_days": clamp_int(10 + (pc * 2), 0, 90),
                "penalty_severity": round(clamp_float(ps + 0.05, 0.1, 1.0), 2),
                "weight": 0.6,
                "source": "proxy: privacy compliance",
            }

            dirty |= upsert_action(privacy_actions, consumer_action)
            dirty |= upsert_action(privacy_actions, breach_action)

        # mobility: add inspections + penalties.
        mobility_actions = (domains.get("mobility") or {}).get("actions") or []
        vehicle_action = find_action(mobility_actions, "Vehicle reg")
        if isinstance(vehicle_action, dict):
            dirty |= set_if_changed(vehicle_action, "weight", 1.0)
            dirty |= set_if_changed(vehicle_action, "source", "proxy: mobility compliance")
            dirty |= normalize_action_numbers(vehicle_action)

            pc = int(vehicle_action.get("permission_count", 3))
            ps = float(vehicle_action.get("penalty_severity", 0.45))

            inspection_action = {
                "name": "Inspection / emissions compliance",
                "permission_count": clamp_int(pc, 1, 10),
                "median_days": clamp_int(max(0, (pc - 2) * 7), 0, 60),
                "penalty_severity": round(clamp_float(ps + 0.05, 0.1, 1.0), 2),
                "weight": 0.8,
                "source": "proxy: mobility compliance",
            }
            traffic_action = {
                "name": "Traffic enforcement penalties",
                "permission_count": 1,
                "median_days": 0,
                "penalty_severity": round(clamp_float(ps + 0.1, 0.1, 1.0), 2),
                "weight": 0.5,
                "source": "proxy: mobility compliance",
            }

            dirty |= upsert_action(mobility_actions, inspection_action)
            dirty |= upsert_action(mobility_actions, traffic_action)

    # Root-level metadata for reproducibility.
    dirty |= set_if_changed(
        dataset,
        "notes",
        "v2.5: rescaled housing_buy time normalization, expanded action library with weights, and "
        "updated sales_effective_rate from Tax Foundation combined state+avg local rates (January 2025).",
    )
    dirty |= set_if_changed(dataset, "generated_at", date.today().isoformat())
    dirty |= set_if_changed(dataset, "version", "2.5")

    # Cache provenance for the crawl.
    sources = dataset.get("sources")
    if not isinstance(sources, dict):
        dataset["sources"] = {}
        sources = dataset["sources"]
        dirty = True

    desired_sales_tax_source = {
        "url": sales_tax_source.url,
        "table_id": sales_tax_source.table_id,
        "effective_date": sales_tax_source.effective_date,
        "retrieved_at": sales_tax_source.retrieved_at,
    }
    if sources.get("taxfoundation_sales_tax_rates") != desired_sales_tax_source:
        sources["taxfoundation_sales_tax_rates"] = desired_sales_tax_source
        dirty = True

    return dirty


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Update full_states_dataset.json from documented transforms.")
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET_PATH)
    parser.add_argument("--write", action="store_true", help="Write updated dataset back to disk.")

    parser.add_argument("--sales-tax-url", default=DEFAULT_SALES_TAX_URL)
    parser.add_argument("--sales-tax-table-id", default=DEFAULT_SALES_TAX_TABLE_ID)
    parser.add_argument("--sales-tax-effective-date", default=DEFAULT_SALES_TAX_EFFECTIVE_DATE)
    parser.add_argument("--sales-tax-cache", type=Path, default=DEFAULT_SALES_TAX_CACHE_PATH)
    parser.add_argument(
        "--sales-tax-source",
        choices=["auto", "cache", "fetch"],
        default="auto",
        help="Where to load sales tax rates from (default: auto).",
    )

    parser.add_argument("--housing-buy-days-max", type=int, default=DEFAULT_HOUSING_BUY_DAYS_MAX)
    parser.add_argument("--housing-buy-permission-max", type=int, default=DEFAULT_HOUSING_BUY_PERMISSION_MAX)

    args = parser.parse_args(argv)

    dataset = load_json(args.dataset)

    # Load or fetch sales tax rates (cache is the preferred, audited input).
    sales_tax_rates: dict[str, float]
    if args.sales_tax_source in ("auto", "cache") and args.sales_tax_cache.exists():
        cache = load_json(args.sales_tax_cache)
        sales_tax_rates = {k: float(v) for k, v in (cache.get("rates") or {}).items()}
        if not sales_tax_rates and args.sales_tax_source == "cache":
            raise RuntimeError(f"No rates in cache file: {args.sales_tax_cache}")
        retrieved_at = str((cache.get("source") or {}).get("retrieved_at") or date.today().isoformat())
    else:
        if args.sales_tax_source == "cache":
            raise RuntimeError(f"Sales tax cache missing: {args.sales_tax_cache}")
        sales_tax_rates = fetch_taxfoundation_sales_tax_rates(url=args.sales_tax_url, table_id=args.sales_tax_table_id)
        retrieved_at = date.today().isoformat()
        write_json(
            args.sales_tax_cache,
            {
                "source": {
                    "name": "Tax Foundation",
                    "url": args.sales_tax_url,
                    "table_id": args.sales_tax_table_id,
                    "effective_date": args.sales_tax_effective_date,
                    "retrieved_at": retrieved_at,
                },
                "rates": {k: round(float(v), 5) for k, v in sorted(sales_tax_rates.items())},
            },
        )

    source = SalesTaxSource(
        url=args.sales_tax_url,
        table_id=args.sales_tax_table_id,
        effective_date=args.sales_tax_effective_date,
        retrieved_at=retrieved_at,
    )

    dirty = apply_v2_5_transforms(
        dataset,
        sales_tax_rates=sales_tax_rates,
        sales_tax_source=source,
        housing_buy_days_max=args.housing_buy_days_max,
        housing_buy_permission_max=args.housing_buy_permission_max,
    )

    if dirty:
        print("Dataset updated in-memory.")
    else:
        print("No changes needed (dataset already matches v2.5 transforms).")

    if args.write:
        write_json(args.dataset, dataset)
        print(f"Wrote: {args.dataset}")
    else:
        print("Dry run (use --write to save).")

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
