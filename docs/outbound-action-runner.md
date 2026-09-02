# Outbound action runner

The `Execute approved outbound action` workflow executes supported GitHub
issues after the `approval:approved` label is added. The executor only accepts
Target product URLs and only adds one item to the cart. It does not implement
checkout or purchasing.

## Automatic monitored-listing actions

Every monitored listing exposes an **Auto add one when available** checkbox.
Saving a checked box records listing-specific approval under the current terms
version. No GitHub issue or approval label is used for these automatic actions.

After two fresh authoritative observations confirm `IN_STOCK` or `PREORDER`,
the monitoring transaction queues one cart action for that availability
episode. Repeated in-stock checks do not queue duplicates. A confirmed
non-orderable state rearms the listing for a later availability episode.

The monitor worker drains at most one queued cart action per tick. Before
reporting success it requires both:

- the exact product line quantity to increase by one; and
- total quantities across actual cart lines to increase by one.

Recommendations, saved items, cart-header count alone, and unrelated product
links are never accepted as proof.

Built-in adapters cover Target, Best Buy, Pokémon Center, Walmart, GameStop,
Costco, Sam's Club, Barnes & Noble, and TCGplayer. Retailer challenges,
ambiguous controls, profile mismatches, and unsupported cart markup fail
closed without checkout.

## Runner requirements

Register a self-hosted runner for this repository with these labels:

```text
self-hosted, Windows, X64, target-shopping
```

Run the agent under the same interactive Windows account that owns the Chrome
profile and has Node.js 24 installed.

## Chrome profile access

Set the repository variable `DEALHUNTER_CHROME_PROFILE_NAME` to the visible
name of the signed-in Chrome profile, for example `Peter`.

The executor opens a dedicated Chrome window in the existing profile, verifies
the profile name, and closes only that temporary window. It does not use a CDP
port or a copied browser profile.

## Manual execution

Use **Actions > Execute approved outbound action > Run workflow** and provide
the number of an open issue carrying the `approval:approved` label. Successful
actions add a completion comment and close the issue. Failures leave the issue
open and add an error comment.
