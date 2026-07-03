# Manual Evidence

When a target has no runnable test command (prompts, docs, workflows), verification
is *manual* — but manual is evidence, not a loophole. Fill this in and attach the
result to the evolution event. A KEEP still requires that these checks were actually
performed and passed.

```
Target:
Goal:
Mode:   code | prompt | docs | workflow
```

## Checks

- [ ] A lazy model cannot escape the instruction.
- [ ] The artifact still forces a concrete output.
- [ ] It prevents self-praise.
- [ ] It leaves durable state.
- [ ] No unrelated scope was touched.
- [ ] The next action cannot be misread.

## Verdict

```
KEEP | REVERT | ASK
```

## Evidence notes

<!-- What you actually observed. "Looks good" is not evidence; name the specific
     check that passed and how you know. -->
