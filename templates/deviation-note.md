# Deviation: <one line — what the map did not predict>

- **Date:** <ISO date>
- **Against map:** .ratchet/unknowns-map.md
- **Needs user judgment?** yes | no

## Map said
<What the map assumed or planned for this part.>

## Code revealed
<What the terrain actually showed once you built it — evidence: file:line.>

## Call made
<The conservative call you took to keep moving without silently absorbing the surprise.>

## Record as
<Pick one and write it to state:
- committed a path → `ratchet state append decisions '{"choice":"...","rejected":"...","tripwire":"..."}'`
- needs the user → `ratchet state append openLoops '{"text":"deviation: ...","status":"open"}'`
- a real failure → `ratchet defect add '{"severity":"...","summary":"..."}'`>
