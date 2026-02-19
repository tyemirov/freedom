# The Vector of Liberty: Action-Based Freedom Score

**Live Project:** [tyemirov.net/freedom](https://tyemirov.net/freedom)

## The Core Idea

Most political discourse defines "freedom" in absolute, unquantifiable terms. This project rejects that approach. Freedom is not an atmospheric condition or a vague sentiment; it is a **specific implementation of policy**.

This repository contains a tool for quantifying liberty by decomposing it into a vector of specific domains. Instead of asking if a state is "free," we measure the **Action Friction** of concrete tasks (e.g., building an ADU, starting an LLC, or homeschooling).

### Key Concepts

-   **Freedom as a Vector:** Liberty varies across different axes. A jurisdiction may be "free" for a renter but "oppressive" for a builder.
-   **Action Friction:** A composite metric of *Permission Control* (how many permits?), *Time Control* (how many days?), and *Penalty Severity* (what is the risk of acting without permission?).
-   **Fiscal Control:** Viewing taxation not as a "price for society," but as a direct reduction of an individual's **Action Potential** and **Marginal Keep Rate**.
-   **Jurisdictions as Operating Systems:** Viewing states like software. California is a high-cost, high-feature, high-latency OS. New Hampshire is a minimalist, low-latency kernel.

## Features

-   **50-State Dataset:** Realistic proxies synthesized from the Tax Foundation, HSLDA, Cato Institute, and Mercatus Center.
-   **Weighted Goals:** Customize your "Freedom Score" by weighting the domains that matter to you (Renting, Building, Business, Schooling, etc.).
-   **Interactive Visualizations:**
    *   **Radar Chart:** Compare domain-specific freedom (higher is freer).
    *   **Scatter Plot:** Visualize the trade-off between Fiscal Control (taxes) and Permission Control (regulation).
-   **Jurisdiction Selector:** Compare jurisdictions side-by-side.

## Technical Structure

-   **Client-Side Architecture:** The entire calculation engine runs in the browser (`script.js`). No backend logic is required, ensuring transparency and speed.
-   **MPR-UI Integration:** Uses the Marco Polo Research Lab UI shell (`mpr-ui.js`, `mpr-ui.css`) for consistent navigation and theming.
-   `index.html`: The core UI, implementing the "Mint & Cream" aesthetic.
-   `full_states_dataset.json`: A v2.5 dataset containing granular metrics for all 50 US states.
-   `state_shapes.json`: Optimized SVG paths for US state silhouettes.
-   `article2.md`: The publication draft for the project essay.

### Dataset Notes

Each domain is defined by a small set of concrete actions. Actions use:
-   `permission_count`, `median_days`, `penalty_severity` (0..1)
-   Optional: `weight`, `days_max`, `permission_max`, `source`

See `DATASET.md` for the full schema and proxy-generation methodology. To refresh the crawled inputs and re-apply transforms:

```bash
python scripts/update_dataset.py --write
python scripts/validate_dataset.py
```

## Testing

Run all checks (dataset invariants + `index.html` browser smoke tests):

```bash
npm test
```

Run only UI smoke tests:

```bash
npm run test:ui
```

## Sources & Methodology

Metrics are synthesized from:
-   **Fiscal:** Tax Foundation (2025 State Tax Competitiveness Index)
-   **Schooling:** HSLDA (Homeschool Laws Regulatory Tiers)
-   **Regulatory/Land Use:** Cato Institute (Freedom in the 50 States)
-   **Zoning Friction:** Mercatus Center (Land Use Freedom Index)

## License

This project is open for exploration and jurisdictional arbitrage. 

---
*Freedom isn't found. It is calculated, selected, and then lived.*
