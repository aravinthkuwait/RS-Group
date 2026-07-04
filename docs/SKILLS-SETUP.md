# Skills & MCP setup — RS Group repo

This repo ships **behavioral skill ports** in `.claude/skills/` (caveman, memory,
ponytail, headroom, graphify, ruflo) that work in any Claude Code session on this
repo with no setup. This page is for turning on the **full upstream engines**
(plugins, MCP servers, Python/CLI tools) when you want them — run these in an
**interactive** Claude Code / terminal session (they can't be installed headlessly).

Commands below are quoted from each project's own README (verified 2026-07-03).

## Already wired for you

- **ruflo MCP** — configured in the repo's `.mcp.json`
  (`npx ruflo@latest mcp start`). When you open this repo in Claude Code it will
  ask you to approve the `ruflo` MCP server; approve it once and ruflo's tools
  (memory, loops, sandboxes, controls) load automatically here.
  Equivalent manual command: `claude mcp add ruflo -- npx ruflo@latest mcp start`

## Run once on your machine to enable the heavy engines

### ponytail (native Claude Code plugin)
```
/plugin marketplace add DietrichGebert/ponytail
/plugin install ponytail@ponytail
```
(The always-on behavioral port already applies the ponytail discipline; the
plugin adds its slash-commands like audit/review/debt.)

### graphify (Python skill — real queryable knowledge graph)
```bash
pip install graphifyy && graphify install     # or: pipx install graphifyy
```
Then in Claude Code: `/graphify .` to index this repo into a real graph.

### headroom (PyPI CLI + MCP server — real token compression)
```bash
pip install "headroom-ai[all]"
headroom mcp install        # registers the headroom MCP server with Claude
```

### ruflo (full harness / 33 plugins — optional, beyond the MCP above)
```bash
npx ruflo@latest init wizard
```

## Notes
- The `.mcp.json` server is **approval-gated** — Claude Code never runs a project
  MCP server without your say-so, so committing it is safe.
- `pip`/`npx`/plugin installs live on the machine that runs Claude Code, not in
  this repo, so they must be run in your interactive environment.
- The behavioral ports and the real engines coexist; the engines just add
  persistent state and dedicated tools.
