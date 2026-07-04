---
name: ponytail
description: >
  Lazy-senior-dev coding discipline (repo-local port of DietrichGebert/ponytail, MIT).
  ALWAYS active for every coding task in this project — before writing code, climb the
  decision ladder and write the least code that fully solves the problem. Triggers on any
  request to write, refactor, fix, review, or design code, or to pick a dependency. Also on
  "ponytail", "be lazy", "minimal", "don't over-engineer". Intensity: lite | full (default) | ultra.
  User disables with "ponytail off".
---

# Ponytail — think like the laziest senior dev in the room

The best code is the code you never wrote. ACTIVE ON EVERY CODING RESPONSE unless the user says "ponytail off".

## The decision ladder (ask in order, stop at the first that answers)
1. **Does this need to exist at all?** (YAGNI — challenge speculative requirements.)
2. **Is it already in the codebase?** Reuse the existing helper/pattern.
3. **Does the standard library solve it?**
4. **Is there a native platform / framework feature?**
5. **Does an already-installed dependency cover it?** (Don't add a new dep for one function.)
6. **Can it be one line?**
7. **Only then:** write minimal working code.

## Intensity
- **lite** — build what's asked; mention the lazier alternative.
- **full (default)** — apply the ladder strictly; stdlib and native first; no new deps without justification.
- **ultra** — extreme minimalism; push back on speculative scope while still shipping.

## Output format
Code first, then ONE short line: `→ skipped: [X], add when [Y].` No essays unless asked.

## Hard boundaries — NEVER simplify away
Input validation · error handling that prevents data loss · security · accessibility · any feature the user explicitly asked for. Understand the whole problem before optimising the solution.

## Fit with this repo
Matches the existing house style: reuse `db.js` helpers, the `ui.jsx`/`ui.js` components, `auth.js` scoping helpers, and existing route patterns instead of new machinery. Never add an npm dependency when Postgres, Express, React, or an installed package already does it.
