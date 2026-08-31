# DealHunter: Unresolved Implementation Handoff

## Purpose

This document records functionality that is incomplete, unavailable, or intentionally not implemented so another engineer can continue without repeating the investigation.

## Current working state

The application is running locally at:

```text
http://localhost:3000
```

Implemented functionality includes:

- Project, product, listing, retailer, rule, notification, and purchase-intent workflows.
- Live Best Buy HTTP monitoring using fulfillment button state.
- Live Target monitoring using a rendered primary-product section and primary button state.
- Product detail pages with locally cached images for all 18 products in the Pokémon project.
- Adaptive randomized schedules with project inheritance, retailer floors,
  bounded ranges, and explicit fixed overrides.
- Per-check logs, filters, pagination, and product monitoring timelines.
- Product planning with separate retailer, latest result, check status, and
  last-checked columns, including direct retailer product links.
- Project listing filters by retailer and availability status.
- Listing removal from product detail pages.
- Discord webhook delivery.
- Rule editing and deletion.
- Actionable alert policies covering in-stock, preorder, backorder, and limited
  ordering states.
- A modular challenge-handler interface with a safe default implementation.
- Evidence classes recorded on snapshots and monitoring runs.
- Fresh second-observation confirmation for authoritative actionable
  candidates.
- Separate confirmed availability, price, and timestamp fields.
- Per-rule/per-listing predicate transition state.
- Unique alert transition keys preventing duplicate alerts.
- Real dual-model learning through noninteractive GitHub Copilot CLI calls.
- Sanitized DOM, visible text, accessibility, screenshot, HTTP source, and network-summary learning artifacts.
- Versioned monitor recipes, generated recipe tests, activation, rollback references, and learning history.
- User-triggered **Relearn monitoring** controls.
- Configurable DOM and screenshot model settings, defaulting to `gpt-5-mini`.
- Configurable Playwright, SeleniumBase, or automatic screening-engine selection.
- Retailer recipe memory reused across the 24 current project listings.

## 1. Pokémon Center availability remains inaccessible

### Observed behavior

Ordinary HTTP requests to Pokémon Center product pages return HTTP 200 but contain an Incapsula challenge document:

```text
Title: Pardon Our Interruption
Signals: _Incapsula_Resource, reese84, hCaptcha-related cookies
```

Ordinary headless Playwright navigation receives:

- An empty rendered body.
- An empty document title.
- Incapsula and challenge-resource requests.
- No product DOM, price, availability, or purchase controls.

The same behavior was observed for:

- US product URLs.
- Canadian regional product URLs.
- `/en-ca/sku/...` URLs.
- Common Salesforce Commerce Cloud-style `Product-Show` and `Product-Variation` paths.

### Robots policy

Pokémon Center's published `robots.txt` explicitly disallows paths including:

```text
/availabilities
/carts
/items
/offers
/prices
/orders
/checkout
/site/*/resourceapi/
```

These endpoints were not adopted as monitoring fallbacks.

### Current system behavior

The adapter now detects the challenge correctly and records:

```text
resultStatus: CHALLENGE
availability: UNKNOWN
confidence: 0
```

It preserves the prior confirmed product state and applies a system-recommended cooldown of approximately 15 minutes rather than retrying at the healthy cadence.

The application also stores a separately labeled first-party search-index hint for SKUs whose indexed official page currently says unavailable:

```text
availability_hint: UNAVAILABLE
availability_hint_source: OFFICIAL_PAGE_SEARCH_INDEX
authoritative_live: false
```

This hint is displayed in the UI but cannot trigger, confirm, or rearm an availability rule.

### Completed official-source research

The storefront uses internal page APIs including:

```text
/tpci-ecommweb-api/product/{sku}?format=zoom.nodatalinks
/tpci-ecommweb-api/search
```

Public traffic descriptions indicate that these responses can contain price and availability fields. Current compliant requests receive HTTP 403 security-service responses. These interfaces are undocumented, have no public service guarantee, and related inventory, item, offer, price, Cortex, and resource API paths are disallowed by the published robots policy.

No compliant independently accessible source was found for guaranteed live Pokémon Center inventory. Search-index metadata may be stale and therefore cannot establish `IN_STOCK`.

### Official product images

The following official Pokémon Center DAM images are accessible and now cached by DealHunter:

```text
10-10447-111
https://www.pokemoncenter.com/images/DAMRoot/Thumbnail/10048/P11454_10-10447-111_01.jpg

10-10449-121
https://www.pokemoncenter.com/images/DAMRoot/Thumbnail/10050/P11451_10-10449-121_01.jpg

10-10449-122
https://www.pokemoncenter.com/images/DAMRoot/Thumbnail/10050/P11451_10-10449-122_01.jpg

10-10667-101
https://www.pokemoncenter.com/images/DAMRoot/Thumbnail/10050/P12487_10-10667-101_01.jpg

10-10451-115
https://www.pokemoncenter.com/images/DAMRoot/Thumbnail/10049/P11460_10-10451-115_01.jpg
```

Static image availability proves product identity only and is never treated as inventory evidence.

Relevant code:

- `src/lib/monitoring.ts`
  - `detectPokemonCenterChallenge`
  - `acquireObservation`
  - `calculateNextSchedule`
- `src/lib/challenges.ts`
  - `ChallengeHandler`
  - `resolveChallenge`
  - `safe-default`

### Still needed

An approved, authoritative source for current Pokémon Center inventory must be identified. Potential compliant sources to investigate include:

- An officially documented retailer API.
- An approved affiliate or inventory feed.
- An official regional storefront that exposes product fulfillment without a challenge.
- An authorized retailer session mechanism that permits automated inventory access.
- Official retailer-generated stock notification events.

Search-engine snippets and marketplace listings are not authoritative enough to establish current Pokémon Center availability.

## 2. Automated CAPTCHA solving and anti-bot bypass were not implemented

The system does not implement:

- Automated CAPTCHA solving.
- hCaptcha or reCAPTCHA token generation.
- Incapsula challenge bypass.
- Browser fingerprint masking.
- Stealth browser patches.
- Proxy or identity rotation intended to evade controls.
- Automated behavior designed to conceal that monitoring is occurring.

The current challenge interface supports only:

```text
RETRY_AFTER
USE_APPROVED_ALTERNATE
QUARANTINE
```

Any additional challenge provider would need to implement the `ChallengeHandler` contract and define its policy, capabilities, audit behavior, and failure semantics.

## 3. LLM-based monitor-recipe learning is implemented with remaining limitations

The proposed architecture is documented at:

```text
http://localhost:3000/dealhunter-system-design.html
public/dealhunter-system-design.html
```

The design specifies:

1. Initial URL learning using a cheap DOM-focused LLM.
2. Independent screenshot interpretation.
3. Generation of a deterministic monitor recipe.
4. Automated recipe tests and shadow validation.
5. Deterministic ongoing monitoring with no LLM calls.
6. User-triggered relearning.
7. Versioned retailer knowledge reuse.

Implemented:

- Noninteractive GitHub Copilot CLI learning provider.
- Separate DOM and screenshot analysis calls.
- Configurable DOM model, visual model, and reasoning effort.
- Default `gpt-5-mini` low-effort learning configuration.
- HTTP source, sanitized DOM, visible text, accessibility tree, screenshot, and network-summary capture.
- Strict structured model output validated with Zod.
- One automatic schema-repair retry for malformed model output.
- Constrained deterministic monitor-recipe DSL.
- Generated recipe validation tests.
- Recipe versioning and activation.
- Rollback recipe references.
- Product-level **Learn monitoring** and **Relearn monitoring** controls.
- Learning-run history in the product UI.
- Retailer-level recipe knowledge reuse.
- Playwright learning capture with HTTP source, network summary, accessibility tree, DOM, text, and screenshot.
- Optional SeleniumBase standard-browser capture backend for DOM, text, and screenshots.

The current Pokémon project has active learned recipes for every listing:

```text
Best Buy:       12 BEST_BUY_FULFILLMENT recipes
Target:          6 TARGET_PRIMARY_CONTROL recipes
Pokémon Center:  6 CHALLENGE_ONLY recipes
```

Remaining limitations:

- Learning executes synchronously rather than through a durable background queue.
- `GENERIC_DOM` recipes are intentionally rejected because a safe generic selector executor is not implemented.
- Best Buy and Target recipe strategies dispatch to tested retailer-specific runtime implementations.
- Shadow validation runs generated tests immediately but does not yet compare candidate and active recipes over a multi-observation window.
- Rollback references are stored, but a user-facing rollback action is not implemented.
- Automatic drift detection does not yet launch a relearning job.
- Copilot CLI is the only real configured provider; an OpenAI-compatible remote provider is not implemented.
- Learning artifacts are stored on the local filesystem rather than object storage.
- SeleniumBase is optional and is not installed in the current Python environment. Selecting it produces an explicit dependency error until `requirements-screening.txt` is installed.
- SeleniumBase capture currently lacks Playwright-equivalent network and accessibility snapshots.
- SeleniumBase UC/CDP stealth and CAPTCHA-solving modes are intentionally not integrated.

## 4. Retailer knowledge memory is partially implemented

Implemented retailer knowledge:

- Approved retailer and image domains.
- Built-in versus user-added retailer identity.
- Current schedule mode and bounds.
- Recent retailer success and failure history.
- Challenge signatures in code.
- Product image-source fallback mappings.
- Versioned retailer knowledge records.
- Shared page archetype, strategy, selectors, availability rules, challenge signatures, and excluded regions.
- Reuse of a validated representative recipe across other products from the same retailer.
- Product-specific rebinding of expected title, SKU, and URL host.

Not implemented:

- Automated scoring to select among multiple retailer knowledge versions.
- Learned network-field execution beyond the existing retailer strategies.
- Full fixture artifacts stored as first-class database records.
- DOM and screenshot artifact hashes.
- Drift-event records.
- Cross-product recipe performance scoring.

Proposed entities:

```text
retailer_knowledge
learning_run
monitor_recipe
recipe_test
listing_recipe
drift_event
```

## 5. Evidence and confirmation architecture is partially implemented

Implemented:

- Evidence class persisted with snapshots and monitoring runs.
- Generic SEO metadata cannot independently establish an in-stock result.
- Authoritative actionable candidates receive a fresh second observation.
- Failed confirmation cannot update confirmed availability.
- Failed and unknown attempts do not overwrite confirmed availability or price.
- Rule state is tracked per rule and listing.
- Alerts are emitted only on a non-matching-to-matching transition.
- Unique transition keys prevent duplicate alerts and purchase intents.

Still missing:

```text
evidence_fact
availability_decision
confirmation_group
```

Consequences:

- Individual evidence sources cannot be independently replayed.
- Confirmation currently repeats the active adapter rather than requiring two distinct evidence mechanisms.
- Parser precedence remains encoded in adapter code rather than stored recipes.
- Confirmation attempt details are summarized rather than stored as separate evidence facts.
- Manual scans and scheduler scans are not protected by a distributed listing lease.

The system does prevent overlapping ticks inside the current local worker, but this does not replace a database-backed or Redis-backed distributed lease.

## 6. Production queue and database infrastructure is not implemented

The current application uses:

- Node's local SQLite implementation.
- A local randomized `setTimeout` monitoring worker with in-process scan
  pacing.
- A single-machine filesystem image cache.
- In-process scheduling calculations.

The production design requires:

- PostgreSQL.
- Redis and BullMQ or an equivalent durable queue.
- Per-retailer queues.
- Distributed listing leases.
- Transactional outbox delivery.
- Persistent pooled browser workers.
- Object storage for screenshots and evidence.
- Separate monitoring, browser, notification, and purchasing worker identities.
- Autoscaling and backpressure controls.

## 7. Target monitoring still has transient browser failures

Target monitoring now correctly scopes the product section and requires the primary Add to cart control to be enabled before reporting `IN_STOCK`.

It can still encounter intermittent:

```text
page.waitForFunction timeout
NETWORK_ERROR
UNKNOWN
```

The application preserves last-confirmed availability during these failures. Further improvements should include:

- A persistent Chromium worker pool.
- Network-response extraction from Target's deferred enrichment request.
- Per-listing browser retry limits.
- Browser context health tracking.
- Explicit differentiation between retailer challenge, page timeout, and missing fulfillment state.

## 8. Real retailer checkout and order submission are not implemented

The system creates guarded purchase intents but does not:

- Authenticate to retailer accounts.
- Add products to a real retailer cart.
- Verify a real cart's exact SKU and seller.
- Read final tax, shipping, and fees.
- Submit retailer orders.
- Reconcile real order history.

Purchase approval currently stops before external order submission.

## 9. Current test coverage

Available checks:

```powershell
npm test
npm run typecheck
npm run lint
npm run test:e2e
```

Current automated coverage includes:

- Best Buy fulfillment versus JSON-LD conflict.
- Target disabled Add to cart handling.
- Pokémon Center challenge-shell detection.
- Fixed, bounded, inherited, and adaptive randomized schedule calculation.
- Backoff windows for failures, rate limits, and challenge responses.
- Actionable availability matching for in-stock, preorder, backorder, and
  limited states.
- Discord embed generation.
- Dashboard navigation.
- Project and product creation.
- Listing and rule creation.
- Listing filtering and removal.
- Rule editing and deletion.
- Per-retailer product results, check status, timestamps, and direct links.
- Repeated monitoring runs.
- Run-log filtering and pagination.
- Product timeline filtering and pagination.
- Discord webhook delivery.
- Purchase-intent approval.
- URL-based product crawling and image caching.
- Retailer create, update, and delete.

Missing high-value tests:

- Concurrent distributed workers.
- Out-of-order monitoring completion.
- Confirmation using two independent evidence mechanisms.
- Retailer recipe generation.
- Recipe shadow comparison and rollback.
- LLM provider failure.
- Screenshot and DOM disagreement.
- Playwright-to-SeleniumBase automatic fallback after a technical browser-engine failure.
- Multi-observation shadow comparison and recipe rollback UI.
- Parser kill-switch activation during a run.
- Challenge-provider plugin behavior.
- Real cart and order reconciliation.

## 10. Important source files

```text
src/lib/monitoring.ts
src/lib/product-crawler.ts
src/lib/challenges.ts
src/lib/retailer-registry.ts
src/lib/db.ts
src/lib/queries.ts
src/app/actions.ts
src/app/products/[productId]/page.tsx
src/app/projects/[projectId]/page.tsx
scripts/monitor.ts
scripts/mine-project-images.ts
tests/unit/monitoring.test.ts
tests/e2e/deal-hunt.spec.ts
public/dealhunter-system-design.html
```

## Recommended next implementation order

1. Move learning runs to a durable background queue.
2. Add multi-observation shadow comparison and a user-facing rollback action.
3. Implement automatic drift-event creation and optional relearning proposals.
4. Build a safe generic deterministic DOM recipe executor.
5. Add database-backed listing leases across manual and scheduled workers.
6. Move scheduling and history to PostgreSQL and Redis-backed queues.
7. Add persistent browser pools and per-retailer worker isolation.
8. Add object storage and retention for learning artifacts.
9. Identify an approved authoritative Pokémon Center inventory source.
10. Implement real cart preflight before considering order submission.
