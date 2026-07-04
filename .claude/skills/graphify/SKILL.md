---
name: graphify
description: >
  Knowledge-graph mental model of the codebase (behavioral port of safishamsi/graphify, an AI
  coding-assistant skill that turns any folder of code, SQL schemas, scripts, docs, papers,
  images or videos into a queryable knowledge graph). Use ON DEMAND when a task needs
  cross-file/entity reasoning: "map this", "how does X connect to Y", "trace the flow",
  "what depends on this", impact analysis, onboarding to a subsystem, or a schema/route audit.
  Not always-on. Triggers on "graphify", "knowledge graph", "map the codebase", "trace".
---

# Graphify — reason over the code as a graph of entities & relationships

Full engine (Python graph builder + MCP query server, multi-modal ingest) is NOT installed here;
this is the behavioral layer. Apply its model: **build the graph in your head/notes, then query it.**

## Build the graph before answering a cross-cutting question
Extract **nodes** and **edges** across files, then reason over them:
- **Nodes**: routes/endpoints, DB tables, React pages/components, server modules, permissions/roles, background jobs, external services.
- **Edges**: *calls*, *imports*, *reads/writes table*, *requires permission*, *renders*, *emits/handles event (SSE)*, *branch-scoped by*.

## How to use it in this repo
- Map an endpoint → which `routes/*.js` handler → which tables (`schema.sql`) → which web page (`web/src/pages`) and mobile screen (`mobile/src/screens`) consume it → which permission gates it (`auth.js`).
- **Impact analysis**: before a change, list the nodes touching the target node (e.g. "everything that reads `stock_batches`") so nothing is missed across web + mobile + reports + e2e.
- **Onboarding / tracing**: answer "how does billing flow" as a path — POS → `/api/sales` → `sales.js` tx → `sale_items`/`stock_batches` → notifications/broadcast → dashboard.
- Present findings as a short node→edge→node list or a small Mermaid graph, not a file dump (compose with **headroom**).

## Honesty
This surfaces the graph by reading the repo on demand; it does not persist a real graph DB. For the actual persistent/queryable graph + multi-modal ingest, install the upstream graphify skill and its MCP server.
