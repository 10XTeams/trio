# Trio

Trio is a local Markdown wiki for Claude Code. Point it at any folder on your disk and it serves the contents as a browser-based wiki — file tree, Markdown preview, sticky notes, light/dark theme, all powered by a Python stdlib HTTP server.

It ships as a Claude Code plugin with two slash commands:

- `/trio:view-document` — start the server and open the current shell `$PWD` as a wiki in your browser.
- `/trio:stop` — shut the server down.

## Install

The repo's `.claude-plugin/marketplace.json` registers `./src-plugin` as the plugin source, so cloning the repo and adding it as a marketplace in Claude Code is enough. After Claude Code reloads the marketplace, the slash commands appear.

## Requirements

- macOS
- Python 3 on `PATH`
- Google Chrome (falls back to the default browser if absent)

## Features

- **File tree**: Sidebar navigator over the chosen folder.
- **Markdown preview**: Renders via `marked.js`, with mermaid diagram support.
- **Editor**: A separate `Edit.html` page for in-browser Markdown editing, written back through the server.
- **Sticky notes**: Highlight any text → mini toolbar → 5 colors. Notes persist as `.json` under `trio/notes/` in the viewed folder.
- **Note navigation**: Topbar arrows + `Left` / `Right` to jump between notes.
- **Risk navigation**: Step through `[!WARNING]` blockquotes on the current page.
- **Outline**: Auto-generated heading outline panel.
- **Theming**: Light/dark with CSS custom properties; toggle persists via `localStorage`.

## Development

See `CLAUDE.md` for layout, code conventions, and the (manual) release-version bump checklist.
