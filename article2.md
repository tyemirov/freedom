# The Vector of Liberty: Freedom as an Engineering Problem

We have a language problem.

In modern political discourse, **freedom** is a dead word: a universal slogan used to mean whatever the speaker already wanted. When liberty is treated as an absolute moral aura, debate becomes liturgy. Nothing gets clarified, and nothing gets optimized.

But if you cannot measure something, you cannot design for it.

The standard mistake is to define freedom as *“the ability to do whatever one wants.”* That isn’t freedom; it’s a power fantasy. In any real society, other people exist, property exists, incentives exist, and so do constraints.

So the relevant question isn’t “are there constraints?”

The real question is:

**Given the life you want to live, what is the constraint budget imposed on you by the system you live in?**

That’s measurable. And once it’s measurable, it can be compared, mapped, and improved.

## Freedom is not a flag. It’s a vector.

Most people treat liberty like an atmospheric condition: you’re either in a “free state” or you aren’t. That binary made more sense in an era when most people lived similar lives, worked locally, and had limited exit options.

For a modern builder, entrepreneur, remote worker, homeschooler, or activist, **freedom isn’t a single number**. It varies across domains. A jurisdiction can be “free” for a renter and punitive for a builder. It can be tax-light and regulation-heavy. It can promise rights on paper and still bury you in approval queues.

In other words: freedom is a **vector**.

When you evaluate a jurisdiction, you are not evaluating “vibes.” You are evaluating the ratio of what you can *do* to the friction required to do it.

## Action friction: permissions, time, penalties

Here is the reframing that makes freedom operational:

> Freedom is the set of actions you can take without asking permission, without waiting too long, and without risking disproportionate punishment.

That implies three components you can score for any concrete action:

1. **Permission load:** how many approvals do you need?
2. **Time-to-approval:** how long do you wait if you comply?
3. **Penalty severity:** what happens if you don’t comply?

This maps to lived experience far better than abstract “rankings.” Two states can guarantee the same right in a constitution and still feel radically different if one requires two weeks of paperwork and the other requires nine months and a lawyer.

Formally free systems can be practically unfree.

## Two ledgers: fiscal control and permission control

Once you start measuring constraints, you quickly notice there are two distinct ledgers.

### Ledger A: fiscal control (tax burden)

Taxation is not just funding; it is also control. It reduces the share of your labor you can allocate yourself, and it adds compliance overhead.

Whatever your moral view of taxes, the mechanical metric is straightforward:

- How much of your income is mandatorily extracted (income, payroll, sales, property)?
- What is your **marginal keep rate**: how much of the *next* dollar earned do you actually retain?

These are not philosophical claims. They’re arithmetic inputs to autonomy.

### Ledger B: permission control (regulatory friction)

The second ledger is permission. This is the “can I just do the thing?” layer of daily life:

- housing changes (remodels, ADUs, rentals)
- starting and operating a business (registration, hiring, contractors)
- schooling choices (homeschool compliance)
- speech/assembly (permits and restrictions)
- privacy/reporting burden
- mobility (inspections, enforcement intensity, penalties)

You can argue endlessly about whether any given regulation is good or bad. But you can’t argue that it doesn’t constrain action. It does. The constraint is measurable as friction.

## The model: goal-weighted, action-based

This project exists to turn the above into a tool you can interrogate rather than a narrative you can only argue about.

The model avoids the typical “index” failure mode (opaque expert judgment and political aggregation) by building upward from actions.

### 1) Define domains by actions

Each domain is defined by concrete actions such as:

- **Housing (renting):** rent out a room, run a short-term rental, regain possession after nonpayment
- **Housing (buy/build):** build an ADU, do a major remodel, expand a structure
- **Business:** start an LLC, hire an employee, use contractors without classification traps
- **School:** homeschool compliance steps and constraints
- **Speech:** organize a public demonstration, permit restrictions
- **Privacy:** reporting and data-collection burdens
- **Mobility:** vehicle compliance/inspections, penalties and enforcement

For each action, the dataset stores the three friction components:

- `permission_count`
- `median_days`
- `penalty_severity` (0..1)

Those are normalized and combined into an action friction score. Domain friction is an average of its action frictions.

### 2) Make it personal with goal weights

People talk past each other about freedom because they’re optimizing for different lives.

If you’re a single person renting in a city, you might not care about homeschool compliance. If you’re building and raising kids, housing and schooling dominate your constraints. If you’re starting a company, business agility becomes the bottleneck.

So instead of pretending there is one universal freedom score, the model treats freedom as **goal-weighted constraint**: you choose which domains matter, and the model weights them accordingly.

That isn’t relativism. It’s workload modeling.

### 3) Combine fiscal and permission control

Finally, you choose how much you care about fiscal control (tax burden) versus permission control (regulatory friction). The tool combines the two into a single “control” number, and then reports freedom as:

**Freedom = 1 - Control**

If you dislike the assumptions, you can change them: the action list, the weights, the normalization constants, or the dataset. Engineering models are useful precisely because the assumptions are explicit and editable.

## What the page is for: finding the bottleneck

The goal isn’t to generate a cheap ranking. Rankings are easy.

The goal is to reveal **what binds you**.

You can explore the interactive model and compute your own goal-weighted score at
[tyemirov.net/freedom](https://tyemirov.net/freedom).

The page lets you set personal context (income, household type, spend ratio, home value proxy), choose goals, and weight fiscal versus permission control. Then it shows:

- a **radar chart** of domain freedom (higher is freer)
- a **scatter plot** of fiscal control vs permission control (lower-left is freer)
- a **table** with the top binding domains driving your score

This is performance engineering applied to jurisdictions: stop arguing about “fast” in the abstract and identify where the latency actually is.

## Jurisdictions as operating systems

The final conceptual upgrade is to stop treating jurisdictions as sacred motherlands and start treating them as service providers.

Think of a state as an **operating system**:

- Some are high-feature, high-cost, high-latency, with aggressive background processes.
- Some are minimalist kernels that demand more self-reliance but impose less friction.

Remote work, capital mobility, and internal migration have turned more people into **jurisdictional arbitrageurs** than at any point in history. You are less trapped by geography than your grandparents were. You can shop for the policy implementation that fits your goals.

The point of this project is to make that choice legible.

## Objections, answered cleanly

### “But regulations can be good.”

Yes. Some constraints prevent clear harms (fraud, unsafe construction, pollution). This model isn’t a moral verdict. It is a measurement of constraint. You can have a separate debate about whether the constraint is worth it.

Measurement comes first.

### “This ignores enforcement.”

Enforcement matters. In a mature version of the dataset, enforcement can become another measurable axis (probability of inspection, typical penalties in practice, variance by county/city). The current dataset focuses on structure and comparability; it is designed to be “real-data-ready” as better inputs become available.

### “Composite scores always lie.”

They lie when assumptions are hidden. This model exposes them and lets you edit them.

### “Freedom is internal, psychological, spiritual.”

Also true, and not what this is measuring. This is systemic freedom: the degree to which your environment allows your intended actions with low friction.

## What would make this “real”

Two upgrades would move this from a strong proxy model to a truly auditable system:

1. **A standard action library**
   A stable set of actions that cover most lives, plus optional modules for specific lifestyles (founders, families, activists, retirees).

2. **Primary-source action data**
   For each jurisdiction and action:
   - which permissions are required (statutes + administrative rules)
   - median approval time (public dashboards, admin reporting, or FOIA’d data)
   - penalty schedule (statutory penalties plus typical enforcement where available)

Once you have that, you can discuss “freedom” as a measurable delta over time instead of a narrative.

## The punchline

Freedom is not “no constraints.”

Freedom is:

- how much of your labor you keep discretionary,
- how many actions you can take without permission,
- how long the system makes you wait,
- and how disproportionate the punishment is if you refuse to play along.

That can be measured.

And once it can be measured, it can be engineered.

---

*Explore the live page: [tyemirov.net/freedom](https://tyemirov.net/freedom).*

### References & Further Reading

- Ludwig von Mises, *Human Action*
- Murray Rothbard, *Man, Economy, and State*
- Friedrich Hayek, *The Constitution of Liberty*
- Davidson & Rees-Mogg, *The Sovereign Individual*
- Tax Foundation (State Tax Competitiveness Index)
- HSLDA (Homeschool laws regulatory tiers)
- Cato Institute (*Freedom in the 50 States*)
- Mercatus Center (land use / zoning proxies)

### Glossary

- **Action friction:** A combined score derived from permissions, time, and penalty severity for a concrete action.
- **Permission control:** The aggregate friction imposed by a jurisdiction across goal-weighted domains.
- **Fiscal control:** The effective tax burden and marginal keep rate proxies applied to a personal context.
- **Marginal keep rate:** The share of the next dollar earned that the individual retains after tax.
- **Jurisdictional arbitrage:** The practice of moving residency, business, or assets to lower-friction jurisdictions.
