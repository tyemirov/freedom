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
-   **Jurisdiction Selector:** Compare up to 6 states side-by-side.

## Technical Structure

-   `index.html`: The core UI, styled with vanilla CSS for maximum performance and portability.
-   `script.js`: The calculation engine and Plotly.js implementation.
-   `full_states_dataset.json`: A v2.3 dataset containing granular metrics for all 50 US states.
-   `article.md`: The philosophical foundation for the project, intended for publication on [tyemirov.net](https://tyemirov.net/freedom).

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
