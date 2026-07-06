# Probe: <one line — the unknown this closes>

- **Date:** <ISO date>
- **Against map:** .ratchet/unknowns-map.md (quadrant + item)
- **Mode:** build-for-learn — the proof-of-done is knowledge, not code

## Card

- **Unknown:** <the map item, by quadrant>
- **Hypothesis:** <what you expect touching the terrain to show>
- **Smallest reversible touch:** <throwaway mock, spike, failing test, fixture, instrumentation pass>
- **Allowed surfaces:** <the files/paths it may touch — nothing else>
- **Proof of learning:** <the observation that closes the unknown, whichever way it falls>
- **Disposal rule:** code dies (revert/delete); findings live
- **Durable output:** <map delta + decision | assumption | openLoop | defect>
- **Promotion rule:** no probe code ships by inertia — promotion = a fresh `/ratchet:build`
  under the full proof/seam gates, then retract the probe `--superseded-by <new artifact>`
- **Stop condition:** <time-box / attempt cap — an unfinished probe closes its item as OPEN
  with what it *did* learn>

## Serialize

Open (before touching anything):

```
ratchet artifact add '{"kind":"probe","title":"probe: <unknown>","status":"v0","holes":["disposal: pending"]}'
```

The `disposal: pending` hole drains confidence until the probe is disposed or promoted —
residue cannot read clean.

Close (findings first, then dispose):

```
ratchet state append decisions '{"choice":"<what the probe settled>","rejected":"<the losing hypothesis>","tripwire":"<what reopens it>"}'
ratchet retract <probe-id> --reason "disposed: code reverted; finding recorded as <id>"
```

Promote (rare, explicit — never the default):

```
ratchet retract <probe-id> --reason "promoted: rebuilt for keep under proof/seam gates" --superseded-by <new-artifact-id>
```
