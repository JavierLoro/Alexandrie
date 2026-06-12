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
└── dist/                     # tsc output (npm start)
```
