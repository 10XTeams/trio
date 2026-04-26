# Trio Claude Plugin

This folder is the plugin source. The repo's `.claude-plugin/marketplace.json` points at it directly — Claude Code loads it as-is, no build step.

## Slash commands

- `/trio:view-document` — opens the current folder as a wiki in the browser
- `/trio:stop` — shuts down the background server

## Requirements

- macOS
- Python 3 on `PATH`
- Google Chrome (falls back to the default browser if absent)

## Layout

- `commands/` — slash-command prompts (`/trio:view-document`, `/trio:stop`)
- `skill/server.py` — stdlib HTTP server (no pip deps) backing the wiki UI
- `skill/launch.sh` / `skill/stop.sh` — lifecycle scripts
- `skill/web/` — Trio frontend (served as static files)
- `skill/test_server.py` — server unit tests

## Tests

```bash
cd src-plugin/skill && python3 -m unittest test_server -v
```

## Releasing

Version is hardcoded in three files. On bump, update all three to the same `X.Y.Z`:

- `src-plugin/.claude-plugin/plugin.json` (`version` field)
- `src-plugin/skill/server.py` (`VERSION = "..."`)
- `src-plugin/skill/web/*.html` (`<span class="topbar-version">vX.Y</span>` — major.minor only)
