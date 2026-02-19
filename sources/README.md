# Sources Cache

This directory contains **small, machine-readable snapshots** of crawled source tables used to seed or refresh proxy inputs in `full_states_dataset.json`.

The intent is reproducibility and auditability:

- The raw mapping used by the update scripts is committed here.
- The dataset also records provenance metadata under its top-level `sources` field.

Current files:

- `taxfoundation_sales_tax_rates_2025-01.json`: Combined state + average local sales tax rates (January 2025 table) as published by the Tax Foundation.

