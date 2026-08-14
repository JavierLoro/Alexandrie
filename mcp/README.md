# Alexandrie MCP server

[Model Context Protocol](https://modelcontextprotocol.io) server for Alexandrie, so LLM agents (Claude Code, etc.) can read and write the wiki through typed tools instead of raw HTTP.

Runs over **StreamableHTTP** by default (port `8300`), or **stdio** with `--stdio`.

## Quick start

```bash
cd mcp
npm install
npm run build     # regenerates src/markdown/ from the frontend, then tsc
npm start         # StreamableHTTP on 0.0.0.0:8300

# or for development (tsx, no build step):
npm run dev
```

Register in Claude Code:

```bash
claude mcp add alexandrie --transport http http://<host>:8300/
```

## Configuration

| Env var | Default | Purpose |
| :--- | :--- | :--- |
| `ALEXANDRIE_BASE_URL` | `http://localhost:8201` | Alexandrie backend API |
| `ALEXANDRIE_TOKEN` | — | Auth token (static) |
| `ALEXANDRIE_TOKEN_FILE` | — | Path to a file containing the token; re-read on each request, so the token can be rotated **without restarting** the server |
| `ALEXANDRIE_MCP_PORT` | `8300` | HTTP listen port |
| `ALEXANDRIE_MCP_AUTH_PORT` | — | Optional authenticated listener; requires `ALEXANDRIE_MCP_AUTH_TOKEN_FILE` |
| `ALEXANDRIE_MCP_AUTH_TOKEN_FILE` | — | Full-access token file for the authenticated listener |
| `ALEXANDRIE_MCP_APPS_TOKEN_FILE` | — | Separate read-only token file that enables the Apps profile |

CLI flags: `--stdio` to use stdio transport instead of HTTP.

## Tools

### Read & navigate

| Tool | What it does |
| :--- | :--- |
| `nodes_list` | List nodes; filter by `parent_id` (with `recursive`) and `role`. Empty fields are pruned from the output |
| `nodes_get` | Get one node. Pass `heading` to fetch a single section instead of the whole document |
| `nodes_outline` | Heading tree of a document — discover structure before reading |
| `nodes_search` | Search by title/tags/description; `search_content=true` also searches bodies |
| `nodes_find_refs` | Search document **bodies** and return matching nodes with excerpts |

### Write

| Tool | What it does |
| :--- | :--- |
| `nodes_create` | Create a document (supports `metadata`, e.g. `render: "html"`) |
| `nodes_update` | Replace a document's fields/content |
| `nodes_edit` | In-place find-and-replace edits, applied atomically — no need to resend the whole body |
| `nodes_append` | Append content to a document |
| `nodes_create_from_url` | Fetch a URL and create a document from it |
| `nodes_delete` | Delete a document |

### Auth & ops

| Tool | What it does |
| :--- | :--- |
| `auth_login` | Log in and obtain a token |
| `backup_start` / `backup_status` | Trigger and monitor the async backup |

## ChatGPT / MCP Apps profile

The authenticated listener also exposes a separate **read-only** Apps profile at:

```text
https://<host>/apps/t/<apps-token>/mcp
```

This profile advertises only the five read/navigation tools plus:

| Tool | What it does |
| :--- | :--- |
| `render_wiki_browser` | Search or browse documents in an interactive MCP Apps view |
| `render_wiki_document` | Open one document in the interactive read-only viewer |

The Apps UI is served as `text/html;profile=mcp-app` from
`ui://alexandrie/wiki-browser-v1.html`. The legacy `/t/<shared-token>/` route keeps
the full tool set unchanged. The Apps token must be different from the
full-access token; the server disables the Apps profile if both files contain
the same value. An Apps token is rejected on the legacy full-access route.

For development in ChatGPT, enable developer mode and register the Apps-profile
URL as an MCP connection. The token comes from the secure file referenced by
`ALEXANDRIE_MCP_APPS_TOKEN_FILE`; never copy it into the repo or wiki. Then
place the registered connection ID in
`plugins/alexandrie-wiki/.app.json` under `apps.alexandrie.id` before installing
the packaged plugin. Do not commit or paste the token.

The shared-token route is suitable for personal development only. A publishable
plugin that exposes private wiki data must replace it with MCP-compliant OAuth
2.1 discovery, PKCE and per-user authorization.

## Design notes

- **Token funnel**: the tools are designed to minimize agent context usage. Use them as a funnel: `nodes_find_refs` / `nodes_search` to locate documents → `nodes_outline` to see structure → `nodes_get` with `heading` to read only the relevant section → `nodes_edit` to change only what's needed. Write tools do **not** echo the document content back.
- **Single-source renderer**: `scripts/sync-renderer.mjs` regenerates `src/markdown/` from `frontend/app/helpers/markdown/` on every build (`prebuild`/`predev` hooks), so the `content_compiled` produced by the MCP matches the frontend renderer exactly. **Never edit `src/markdown/` by hand** — it is overwritten on each build and must be run inside the monorepo (next to `frontend/`).

## Layout

```
mcp/
├── src/
│   ├── index.ts              # server + tool registrations, HTTP/stdio transports
│   ├── client.ts             # Alexandrie API client (auth, token file)
│   ├── markdown-outline.ts   # heading-tree extraction for nodes_outline
│   └── markdown/             # GENERATED from frontend — do not edit
├── scripts/sync-renderer.mjs # frontend → src/markdown/ sync (single source)
├── ui/wiki-browser.html      # MCP Apps interactive read-only viewer
└── dist/                     # tsc output (npm start)
```
