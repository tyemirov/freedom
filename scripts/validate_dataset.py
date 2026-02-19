#!/usr/bin/env python3
"""
Validate `full_states_dataset.json` structure and basic invariants.

This is intentionally lightweight: the web app is static, and the dataset is
treated as data, not as a schema-migrated database.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


REQUIRED_DOMAINS = [
    "housing_rent",
    "housing_buy",
    "business",
    "school",
    "speech",
    "privacy",
    "mobility",
]


def fail(message: str) -> None:
    raise SystemExit(f"ERROR: {message}")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Validate full_states_dataset.json invariants.")
    parser.add_argument("--dataset", type=Path, default=Path("full_states_dataset.json"))
    args = parser.parse_args(argv)

    dataset = json.loads(args.dataset.read_text())
    version = dataset.get("version")
    jurisdictions = dataset.get("jurisdictions")

    if not isinstance(version, str):
        fail("dataset.version must be a string")
    if not isinstance(jurisdictions, list) or not jurisdictions:
        fail("dataset.jurisdictions must be a non-empty list")

    names = [j.get("name") for j in jurisdictions if isinstance(j, dict)]
    if len(set(names)) != len(names):
        fail("jurisdiction names must be unique")

    bad_actions: list[tuple[str, str, str, str]] = []
    actions_per_domain: Counter[str] = Counter()
    days_max_by_domain: defaultdict[str, Counter[int]] = defaultdict(Counter)

    for jurisdiction in jurisdictions:
        if not isinstance(jurisdiction, dict):
            fail("jurisdictions must be objects")
        name = jurisdiction.get("name")
        if not isinstance(name, str) or not name.strip():
            fail("jurisdiction.name must be a non-empty string")

        tax = jurisdiction.get("tax_proxies")
        if not isinstance(tax, dict):
            fail(f"{name}: tax_proxies must be an object")

        domains = jurisdiction.get("domains")
        if not isinstance(domains, dict):
            fail(f"{name}: domains must be an object")

        missing = [d for d in REQUIRED_DOMAINS if d not in domains]
        if missing:
            fail(f"{name}: missing domains: {missing}")

        for domain_key in REQUIRED_DOMAINS:
            domain = domains.get(domain_key)
            if not isinstance(domain, dict):
                fail(f"{name}: domain {domain_key} must be an object")
            actions = domain.get("actions")
            if not isinstance(actions, list) or not actions:
                fail(f"{name}: domain {domain_key} must have non-empty actions[]")

            action_names: set[str] = set()
            for action in actions:
                if not isinstance(action, dict):
                    bad_actions.append((name, domain_key, "<unknown>", "action is not object"))
                    continue
                action_name = action.get("name")
                if not isinstance(action_name, str) or not action_name.strip():
                    bad_actions.append((name, domain_key, "<unknown>", "missing name"))
                    continue

                if action_name in action_names:
                    bad_actions.append((name, domain_key, action_name, "duplicate action name"))
                action_names.add(action_name)

                for required in ("permission_count", "median_days", "penalty_severity"):
                    if required not in action:
                        bad_actions.append((name, domain_key, action_name, f"missing {required}"))

                pc = action.get("permission_count")
                md = action.get("median_days")
                ps = action.get("penalty_severity")

                if not isinstance(pc, int) or pc < 0:
                    bad_actions.append((name, domain_key, action_name, f"invalid permission_count={pc!r}"))
                if not isinstance(md, int) or md < 0:
                    bad_actions.append((name, domain_key, action_name, f"invalid median_days={md!r}"))
                if not isinstance(ps, (int, float)) or ps < 0 or ps > 1:
                    bad_actions.append((name, domain_key, action_name, f"invalid penalty_severity={ps!r}"))

                dm = action.get("days_max", 180)
                if isinstance(dm, int) and dm > 0:
                    days_max_by_domain[domain_key][dm] += 1
                    if isinstance(md, int) and md > dm:
                        bad_actions.append((name, domain_key, action_name, "median_days exceeds days_max"))

                actions_per_domain[domain_key] += 1

    if bad_actions:
        for item in bad_actions[:30]:
            print("BAD:", item)
        fail(f"Found {len(bad_actions)} invalid actions")

    print(f"OK: dataset version={version} jurisdictions={len(jurisdictions)}")
    print("Actions per domain:", dict(actions_per_domain))
    print("days_max distributions (top values):")
    for domain_key in REQUIRED_DOMAINS:
        dist = days_max_by_domain[domain_key]
        top = dist.most_common(3)
        print(f"  {domain_key}: {top}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

