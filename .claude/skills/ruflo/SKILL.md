---
name: ruflo
description: >
  Agent meta-harness mindset (behavioral port of ruvnet/ruflo, "an agent meta-harness for Claude
  Code and Codex" — tools, memory, loops, sandboxes and controls so agents collaborate instead of
  working in isolation; ships as Claude Code plugins + an MCP server). Use ON DEMAND for
  multi-step, multi-agent-shaped work: large migrations/audits/sweeps, parallel fan-out, or
  orchestrating a task across sub-agents. Not always-on. Triggers on "ruflo", "orchestrate",
  "fan out", "multi-agent", "run a workflow".
---

# Ruflo — orchestrate; don't grind solo

Full framework (33 plugins, MCP server, `npx ruflo init`) is NOT installed here; this is the
behavioral layer. Apply its principle: **decompose, delegate, verify, converge.**

## When a task is bigger than one pass
1. **Decompose** into independent units (files, modules, branches, dimensions).
2. **Delegate** — fan out with the Agent tool / Workflow rather than doing everything inline; run independent work in parallel.
3. **Memory** — persist decisions and state via the `memory` skill (`.claude/project-memory.md`) so context survives across steps.
4. **Loop with a terminal state** — iterate (find → fix → re-verify) until a clear done condition, not a fixed number of rounds.
5. **Verify adversarially** before converging — a change isn't done until it's exercised (tests / e2e / real flow), echoing this repo's "reseed + `node server/test/e2e.mjs`" habit.
6. **Converge** — synthesize the results into one coherent outcome.

## Fit with this repo
The established loop already is: change → syntax-check → reseed → e2e → build → commit → push → PR → merge → verify deploy. Ruflo just says: when the work is wide, split it and run pieces concurrently instead of serially, and keep a terminal check.

## Honesty
This is the orchestration *mindset*; the real ruflo plugins/MCP (sandboxes, controls, its plugin marketplace) are not installed. To get those, install ruflo upstream (`npx ruflo init`) — requires its MCP server, which isn't available in this headless environment.
