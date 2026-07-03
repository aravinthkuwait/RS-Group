---
name: memory
description: Persistent project memory for the RS Group repo. ALWAYS active for every prompt in this project — read .claude/project-memory.md at the start of a session to load accumulated context, and append a dated entry after completing any significant task (decisions, changes, gotchas, deployment events). Covers requests mentioning "memory", "mem", "remember this", "what did we decide", or "project history".
---

# Project Memory

## On session start
Read `.claude/project-memory.md`. Treat its contents as established project
context — do not re-derive or contradict recorded decisions without the user
asking to revisit them.

## After significant work
Append one dated line per meaningful event to `.claude/project-memory.md`:

```
- 2026-07-03: Migrated backend from SQLite to Supabase Postgres (schema rsgroup).
```

Record: architectural decisions, deployed fixes, credentials locations (never
secret values), user preferences, and gotchas discovered. Keep entries to one
line; newest at the bottom. Commit the file with related changes.

## When the user asks "do you remember / what did we decide"
Answer from `.claude/project-memory.md` first, then git history if needed.
