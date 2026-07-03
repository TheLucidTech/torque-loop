---
name: burn
description: Kill or park the options that are quietly draining energy. Use when you are carrying option debt — too many open possibilities, none advancing. Returns a kill / park / keep table, why each option is attractive, what fear keeps it alive, what gets simpler if it dies, and one option to burn right now.
---

# /ratchet:burn — option debt collection

Open options feel like freedom. They are actually a tax: every one you carry costs
attention whether or not you act on it. This command collects the debt. It kills what is
dead, parks what is premature, and keeps only what earns its place.

## Step 0 — Load state

```
ratchet status
ratchet state get openLoops
```

## Procedure

For each open option, possibility, or half-started thread:

1. **Why it's attractive** — the real pull. Usually optionality, sunk cost, or ego.
2. **What fear keeps it alive** — the thing you're afraid happens if you kill it. Name it;
   fears shrink when named.
3. **What gets simpler if it dies** — the concrete relief. Fewer branches, clearer focus,
   less maintenance.
4. **Verdict:**
   - **KILL** — no path where this matters; end it.
   - **PARK** — might matter later, not now; freeze it with a revisit trigger.
   - **KEEP** — actively advancing the target; it stays.

## Output contract

```
| Option | Attractive because | Fear keeping it alive | Simpler if killed | Verdict |
| ------ | ------------------ | --------------------- | ----------------- | ------- |
| ...    | ...                | ...                   | ...               | KILL/PARK/KEEP |

BURN NOW: <the one option to kill this minute>
DECISION SENTENCE: "<exact words that end it>"
```

## Serialize

Killed and parked options leave state as closed loops so they stop costing attention:

```
ratchet state append openLoops '{"text":"KILLED: <option>","status":"closed"}'
ratchet state append openLoops '{"text":"PARKED until <trigger>: <option>","status":"open"}'
ratchet state set phase decide
```

Next: `/ratchet:decide` on what remains, or `/ratchet:build` if only the keeper is left.
