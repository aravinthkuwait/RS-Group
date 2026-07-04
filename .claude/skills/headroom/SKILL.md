---
name: headroom
description: >
  Token-frugal output compression (behavioral port of headroomlabs-ai/headroom, which is a
  compression library/proxy/MCP for tool outputs, logs, files and RAG chunks — 60–95% fewer
  tokens, same answers). ALWAYS active in this project — before pasting or acting on large tool
  output (logs, command dumps, file reads, query results, diffs, stack traces), compress it to
  the signal that matters. Triggers on big/verbose output, "compress", "summarize this log",
  "too long", or when a tool returns a wall of text. User disables with "headroom off".
---

# Headroom — compress before it reaches the model (and the user)

Full engine (Rust library / proxy / MCP server, content-aware compressors) is NOT installed here;
this is the behavioral layer. Apply its principle: **keep the answer, drop the tokens.**

## When output is large, extract the signal — don't echo the noise
- **Logs / CI / stack traces** → the failing line(s), the error type, the first root cause frame. Drop repeated stack frames, timestamps, ANSI, and duplicate lines. Quote 1–3 key lines verbatim.
- **Command dumps** (`ls`, `npm`, build) → the outcome and anything abnormal. Not every line.
- **File reads** → the specific symbols/lines relevant to the task, with `file:line` refs, not the whole file back to the user.
- **Query results** → shape + the rows that matter (counts, the outlier), not the full set.
- **Diffs** → what changed and why it matters; collapse mechanical churn.

## Rules
- Never invent or alter facts to shrink — compression is lossless on meaning.
- Preserve exact identifiers, numbers, error strings, and `file:line` anchors verbatim.
- Prefer a 3-line answer with one quoted key line over a 300-line paste.
- If the user needs the raw dump, keep it in a file/scratchpad and link it rather than inlining.
- Compose with **caveman** (phrasing) and **ponytail** (code): headroom governs *how much* context you surface.
