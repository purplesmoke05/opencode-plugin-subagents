# opencode-plugin-subagents

opencode TUI sidebar plugin that shows the subagent sessions currently running
in the active project. It reads opencode's own session state, so it works with
any subagent source (OMO, the native task tool, other plugins) and does not
require OMO to be installed.

## What it shows

A bordered `Subagents` section in the right sidebar (next to Context/MCP/LSP),
listing up to 8 running child sessions, oldest first:

```
┌──────────────────────────────────┐
│                                  │
│ Subagents                        │
│ metis      retry 1h   Review th… │
│ explore    busy  2m   Map the s… │
│ librarian  busy  12s  Fetch ups… │
│                                  │
└──────────────────────────────────┘
```

Each row is `name status elapsed title`:

- `name` — the subagent name, resolved from the session title
  (`... (@explore subagent)`), falling back to the first message's `agent`
  field, then `?`
- `status` — `busy` or `retry`; retry rows use the warning color
- `elapsed` — time since the session was created (`12s`, `2m`, `1h`)
- `title` — the session title, truncated to 10 chars

Rows are padded and truncated so every row is exactly 32 chars wide, which
keeps them on a single line inside the sidebar. When more than 8 subagents are
running, a dim `+N more` line is appended. When nothing is running, the section
renders nothing at all (no empty box, no blank line).

## Data sources

All data comes from opencode's own session state — no OMO config is read:

- `api.client.session.list({ directory })` — sessions for the current project
- `api.client.session.status()` — live status map (`idle` / `busy` / `retry`)
- `api.state.path.directory` — the current project directory
- `api.state.session.status(id)` / `api.state.session.messages(id)` — TUI
  state used as a fallback for status and agent name

A session is shown when it has a `parentID` (a child/subagent session), lives
in the current directory, and its status is `busy` or `retry`. The list is
refreshed every 2 seconds and immediately on `session.status`,
`session.created`, and `session.deleted` events. Refresh errors are ignored
silently and the previous snapshot stays on screen.

## Install

Build once:

```bash
npm install && npm run build
```

Then register the TUI plugin in `~/.config/opencode/tui.json`:

```json
{
  "plugin": [
    "file:///absolute/path/to/opencode-plugin-subagents/src/tui.ts"
  ]
}
```

The `file://` entry points at `src/tui.ts` directly because the opencode Bun
runtime loads TypeScript without a build step. Restart opencode after changing
`tui.json`.

## Development

```bash
npm run typecheck   # tsc -p tsconfig.tui.json (no emit)
npm run build       # emits dist/tui.js
```

`src/tui.ts` is fully self-contained (no relative imports) so it can be loaded
directly as a `file://` plugin entry.
