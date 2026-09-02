# DealHunter

DealHunter is a web application for creating product-monitoring projects,
tracking retailer prices and availability, generating alerts, and preparing
guarded purchase workflows.

The included Pokémon 30th Celebration project demonstrates monitoring across
Pokémon Center, Best Buy, and Target.

## Features

- Project, product, listing, retailer, rule, and alert management.
- Product creation from a retailer URL.
- Locally cached product images with source attribution.
- Live HTTP and Playwright-based retailer monitoring.
- Exact retailer status text alongside normalized internal states.
- Price and availability history with filters and pagination.
- Product planning with one row per retailer, latest availability and check
  status, timestamps, and direct retailer product links.
- Retailer and availability filters for project listings, plus listing removal
  from product detail pages.
- Adaptive randomized monitoring by default, with bounded and explicit fixed
  overrides and project-level inheritance.
- Project defaults, retailer guardrails, and listing overrides.
- Actionable alert policies for in-stock, preorder, backorder, and limited
  ordering opportunities.
- System-managed Discord webhooks stored encrypted at rest and selected per
  project.
- Dual-model monitor learning from DOM and screenshot evidence.
- Versioned deterministic recipes, generated tests, retailer memory, and
  user-triggered relearning.
- Playwright and optional SeleniumBase learning-capture backends.

## Requirements

- Node.js 24 or newer.
- npm.
- GitHub Copilot CLI authenticated locally for live monitor learning.
- Playwright Chromium.

Optional SeleniumBase capture requires Python and:

```powershell
pip install -r requirements-screening.txt
```

SeleniumBase is used only through its standard browser automation mode.

## Setup

```powershell
npm install
npx playwright install chromium
npm run dev
```

Open:

```text
http://localhost:3000
```

`npm run dev` starts both the Next.js application and monitoring worker.

## Commands

```powershell
npm run dev
npm run build
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run worker:once
npm run images:mine -- pokemon-30th-celebration
npm run recipes:learn -- pokemon-30th-celebration
```

## Monitor learning

Initial URL learning and explicit relearning capture:

- Normal HTTP source.
- Sanitized DOM.
- Visible text.
- Accessibility representation.
- Screenshot.
- Sanitized network summary.
- Product identity and challenge signatures.

The configured DOM and screenshot models independently analyze the capture.
DealHunter compiles their results into a constrained deterministic recipe,
runs generated validation tests, and activates only validated recipes.

Normal scheduled monitoring does not call an LLM. It executes the active
recipe and records the exact recipe ID and version used.

Learning model and screening-engine choices are available under **Settings**.

## Monitoring and alert behavior

- Healthy adaptive schedules select the next check inside the configured
  minimum and maximum window.
- Recent failures, rate limits, and challenge responses expand that window;
  retailer minimum intervals always remain enforced.
- New and inherited listings receive their first calculated schedule
  immediately instead of defaulting to a fixed one-minute delay.
- The local worker varies its polling interval and spaces checks within a
  project scan to avoid synchronized request bursts.
- Alert policies treat `IN_STOCK`, `PREORDER`, `BACKORDER`, and `LIMITED` as
  actionable ordering states.
- Every actionable candidate requires a fresh authoritative confirmation before
  it can update confirmed state or trigger an alert.
- The Products view keeps retailer, latest availability result, check execution
  status, and last-check time in separate columns. Each retailer name opens the
  monitored product URL directly.

## Local data

Runtime data is stored under:

```text
.dealhunter\
```

This directory contains the SQLite database, encrypted secrets, product images,
and learning artifacts. It is excluded from Git.

Set `DEALHUNTER_DATA_DIR` to use another location.

## Security and monitoring behavior

- Webhook URLs are encrypted before database storage.
- Failed and unknown observations do not overwrite confirmed availability.
- Weak SEO metadata cannot independently establish in-stock status.
- Authoritative actionable candidates require a fresh second observation.
- Rules alert only on confirmed false-to-true transitions.
- Transition keys prevent duplicate alerts.
- Projects explicitly select which configured notification destinations receive
  their alerts, and delivery history is scoped to the originating project.
- Challenge pages produce a challenged or quarantined state rather than a
  fabricated availability result.
- The application does not implement CAPTCHA solving, stealth fingerprinting,
  proxy rotation, or anti-bot bypass.

## Architecture documentation

Run the application and open:

```text
http://localhost:3000/dealhunter-system-design.html
```

Known gaps and implementation handoff details are maintained in
[`UNRESOLVED-IMPLEMENTATION.md`](UNRESOLVED-IMPLEMENTATION.md).
