<div align="center">

<img src="./frontend/public/Logo/Alexandrie-logo-dark.png" width="140">

# Alexandrie — fork

**A self-hosted Markdown knowledge base, extended with an MCP server and HTML documents.**<br>
Fork of [Smaug6739/Alexandrie](https://github.com/Smaug6739/Alexandrie) — all core features come from upstream; this repo adds an agent-friendly layer on top.

[Upstream project](https://github.com/Smaug6739/Alexandrie) · [Live Demo](https://alexandrie-hub.fr) · [Documentation](./docs/README.md)

</div>

![Alexandrie Preview](.github/present.png)

---

## What this fork adds

### 🤖 MCP server (`mcp/`)

A [Model Context Protocol](https://modelcontextprotocol.io) server over StreamableHTTP, so LLM agents (Claude Code, etc.) can read and write the wiki directly:

| Area | Tools |
| :--- | :--- |
| Read & navigate | `nodes_list` (with `parent_id`/`recursive`/`role` filters), `nodes_get` (full doc or a single `heading` section), `nodes_outline`, `nodes_search`, `nodes_find_refs` |
| Write | `nodes_create`, `nodes_update`, `nodes_edit` (find-and-replace, no full-body resend), `nodes_append`, `nodes_create_from_url`, `nodes_delete` |
| Ops | `auth_login`, `backup_start`, `backup_status` |

Design notes:

- **Token funnel**: tools are designed to minimize agent context usage — outlines and per-section reads instead of full documents, write responses don't echo content back, empty fields are pruned.
- **Single-source renderer**: `mcp/scripts/sync-renderer.mjs` regenerates the MCP's markdown pipeline from `frontend/app/helpers/markdown/` on every build, so MCP-compiled content matches the frontend exactly.
- **Restart-free token rotation** via `ALEXANDRIE_TOKEN_FILE`.

```bash
cd mcp
npm install
npm run build     # regenerates src/markdown/ from the frontend, then tsc
npm start         # StreamableHTTP server

# Register in Claude Code:
claude mcp add alexandrie --transport http http://<host>:8300/
```

### 📄 HTML documents

Upload or create `.html` documents and render them as real standalone pages:

- Sandboxed iframe rendering inside the app (stored-XSS safe, same-origin protected)
- `/public/:id` route for standalone HTML docs; `/doc/:id` redirects there automatically
- TOC hidden for HTML documents; works with `metadata.render = "html"` via API/MCP

### 🔒 Backend hardening

- Login protected against brute force (layered defense)
- `CONFIG_DISABLE_SIGNUP` also enforced on OIDC sign-ups

### ✍️ Editor & upload improvements

- Multi-file `.md` upload, with `content_compiled` precompiled so previews render immediately
- Node `metadata` exposed on create/update (API + MCP)

---

## Quick Start

```bash
git clone https://github.com/JavierLoro/Alexandrie.git
cd Alexandrie
cp .env.example .env   # defaults work out of the box
docker compose up -d
```

Open **http://localhost:8200** and create your account.

> **Dev mode with HMR:**
>
> ```bash
> docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
> ```

For manual setup without Docker, see [CONTRIBUTING.md](./CONTRIBUTING.md).

---

## Core features (upstream)

Everything from upstream Alexandrie is here: extended Markdown editor (CodeMirror 6, KaTeX, custom containers), full-text search, workspaces → categories → nested docs, granular 5-level permissions, public sharing, Kanban boards, PWA/offline, SSO/OIDC, S3-based file storage, backups as ZIP, dark/light themes and custom CSS.

See the [upstream README](https://github.com/Smaug6739/Alexandrie#readme) for the full tour and screenshots.

## Tech Stack

| Layer        | Technology                                     |
| :----------- | :--------------------------------------------- |
| **Frontend** | Nuxt 4 (Vue 3), TypeScript, Pinia, SCSS        |
| **Backend**  | Go (Gin), JWT auth, sqlx                       |
| **MCP**      | TypeScript, `@modelcontextprotocol/sdk`, StreamableHTTP |
| **Database** | MySQL 8                                        |
| **Storage**  | S3-compatible (RustFS, MinIO, AWS S3, Garage…) |
| **Infra**    | Docker Compose                                 |

---

## Credits

Alexandrie is built by [Smaug6739](https://github.com/Smaug6739) and contributors, MIT-licensed.
If you find it useful, ⭐ [star the upstream repository](https://github.com/Smaug6739/Alexandrie) and report core issues [there](https://github.com/Smaug6739/Alexandrie/issues); issues about the MCP server or fork-specific features belong in this repo.

<div align="center">
  <sub>Fork maintained by <a href="https://github.com/JavierLoro">JavierLoro</a> · upstream built with ❤️ by <a href="https://github.com/Smaug6739">Smaug6739</a>.</sub>
</div>
