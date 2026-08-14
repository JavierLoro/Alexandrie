import { readFileSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import * as api from "./client.js";
import { parseOutline, formatOutline, extractSection } from "./markdown-outline.js";

// ── Tool definitions ──────────────────────────────────────────────────────────

type ServerProfile = "full" | "apps";

const WIKI_BROWSER_URI = "ui://alexandrie/wiki-browser-v1.html";

type WikiCard = {
  id: string;
  name: string;
  description?: string;
  tags?: string;
  role?: number;
  accessibility?: number;
  updated_timestamp?: number;
  excerpt?: string;
};

function unwrapResult(value: unknown): unknown {
  return (value as { result?: unknown })?.result ?? value;
}

function unwrapNode(value: unknown): Record<string, unknown> {
  const result = unwrapResult(value) as { node?: unknown } | unknown;
  return (((result as { node?: unknown })?.node ?? result) || {}) as Record<string, unknown>;
}

function unwrapNodes(value: unknown): Array<Record<string, unknown>> {
  const result = unwrapResult(value);
  return Array.isArray(result) ? (result as Array<Record<string, unknown>>) : [];
}

function toWikiCard(node: Record<string, unknown>): WikiCard {
  const snippet = typeof node.content_snippet === "string"
    ? node.content_snippet
    : typeof node.content === "string"
      ? node.content.slice(0, 420)
      : undefined;
  return {
    id: String(node.id ?? ""),
    name: String(node.name ?? "Untitled"),
    description: typeof node.description === "string" ? node.description : undefined,
    tags: typeof node.tags === "string" ? node.tags : undefined,
    role: typeof node.role === "number" ? node.role : undefined,
    accessibility: typeof node.accessibility === "number" ? node.accessibility : undefined,
    updated_timestamp: typeof node.updated_timestamp === "number" ? node.updated_timestamp : undefined,
    excerpt: snippet?.replace(/\s+/g, " ").trim(),
  };
}

async function findWikiCards(query: string | undefined, limit: number): Promise<WikiCard[]> {
  const raw = query?.trim()
    ? await api.searchNodes(query.trim(), true, limit)
    : await api.listNodes();
  return unwrapNodes(raw)
    .filter((node) => node.id != null && node.name != null)
    .slice(0, limit)
    .map(toWikiCard);
}

function buildServer(profile: ServerProfile = "full"): McpServer {
  const server = new McpServer(
    { name: profile === "apps" ? "alexandrie-wiki" : "alexandrie", version: "1.5.0" },
    {
      instructions:
        profile === "apps"
          ? "Use search and outline tools before reading full documents. This profile is read-only. Use render_wiki_browser when a visual result helps the user browse or inspect wiki documents."
          : "Use nodes_find_refs or nodes_search first, then nodes_outline, then nodes_get with a heading. Confirm identifiers before writes and never reveal credentials.",
    }
  );

  // AUTH

// Write responses must NOT echo the node content back into the LLM context.
// Return only lightweight metadata (see Plan — Mejoras Alexandrie, bug 2026-06-11).
function writeSummary(node: unknown): string {
  const n = ((node as { result?: unknown })?.result ?? node) as Record<string, unknown>;
  const summary = {
    id: n?.id,
    name: n?.name,
    parent_id: n?.parent_id,
    role: n?.role,
    accessibility: n?.accessibility,
    size: typeof n?.content === "string" ? (n.content as string).length : n?.size,
  };
  return JSON.stringify(summary, null, 2);
}

  if (profile === "full") server.tool(
    "auth_login",
    "Login to Alexandrie and obtain an access token. For normal operations prefer the ALEXANDRIE_TOKEN env var.",
    {
      username: z.string().describe("Alexandrie username"),
      password: z.string().describe("Alexandrie password"),
    },
    async ({ username, password }) => {
      const result = await api.login(username, password);
      return { content: [{ type: "text", text: `Login successful. access_token: ${result.access_token}` }] };
    }
  );

  // NODES
  server.registerTool(
    "nodes_list",
    {
      title: "List Alexandrie nodes",
      description: "List nodes (workspaces, categories, documents). By default lists the whole tree of the authenticated user; use parent_id to list only one branch (recursive=false for direct children only) and role to filter by node type. Null/empty fields are omitted from the output.",
      inputSchema: {
        user_id: z.string().optional().describe("User ID whose nodes to retrieve (omit for current user)"),
        parent_id: z.string().optional().describe("Only nodes under this node (children, or whole subtree with recursive)"),
        recursive: z.boolean().optional().describe("With parent_id: include the full subtree (default true). false = direct children only."),
        role: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional().describe("Filter by type: 1=workspace 2=category 3=document"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ user_id, parent_id, recursive, role }) => {
      const res = (await api.listNodes(user_id)) as { result?: unknown } | unknown[];
      let nodes = (Array.isArray(res) ? res : (res as { result?: unknown })?.result ?? res) as Array<Record<string, unknown>>;
      if (!Array.isArray(nodes)) nodes = [];

      if (parent_id) {
        if (recursive === false) {
          nodes = nodes.filter((n) => n.parent_id === parent_id);
        } else {
          const wanted = new Set<string>([parent_id]);
          let grew = true;
          while (grew) {
            grew = false;
            for (const n of nodes) {
              const id = String(n.id);
              if (!wanted.has(id) && n.parent_id != null && wanted.has(String(n.parent_id))) {
                wanted.add(id);
                grew = true;
              }
            }
          }
          nodes = nodes.filter((n) => wanted.has(String(n.id)));
        }
      }
      if (role !== undefined) nodes = nodes.filter((n) => n.role === role);

      // Podar campos null/vacíos para no quemar contexto con ruido
      const slim = nodes.map((n) => {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(n)) {
          if (v === null || v === "" || k === "permissions" || k === "content") continue;
          if (k === "metadata" && v && typeof v === "object") {
            const { index: _index, ...rest } = v as Record<string, unknown>;
            if (Object.keys(rest).length > 0) out[k] = rest;
            continue;
          }
          out[k] = v;
        }
        return out;
      });
      return { content: [{ type: "text", text: JSON.stringify(slim, null, 2) }] };
    }
  );

  server.registerTool(
    "nodes_get",
    {
      title: "Get Alexandrie node",
      description: "Get a single node by ID. Pass heading to fetch only one section of the document (much cheaper than the full content). If the heading does not exist, the error includes the document outline. Use nodes_outline first to discover the structure.",
      inputSchema: {
        node_id: z.string().describe("Node ID"),
        heading: z.string().optional().describe("Return only this section, e.g. \"## Deploy\" (case-insensitive, '#' optional)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ node_id, heading }) => {
      const node = await api.getNode(node_id);
      if (!heading) {
        return { content: [{ type: "text", text: JSON.stringify(node, null, 2) }] };
      }
      const n = ((node as { result?: { node?: Record<string, unknown> } })?.result?.node ?? node) as Record<string, unknown>;
      const body = typeof n?.content === "string" ? (n.content as string) : "";
      const section = extractSection(body, heading); // lanza Error con outline si no existe
      const out = {
        id: n?.id,
        name: n?.name,
        heading,
        lines: `${section.startLine}-${section.endLine}`,
        content: section.text,
      };
      return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
    }
  );

  server.registerTool(
    "nodes_outline",
    {
      title: "Outline Alexandrie document",
      description: "Get the heading structure (table of contents) of a document without its body — a few hundred bytes instead of the full content. With descriptive=true, includes the per-section one-line summaries auto-generated by the wiki agent (metadata.index), when available.",
      inputSchema: {
        node_id: z.string().describe("Node ID"),
        descriptive: z.boolean().optional().describe("Include per-section summaries from metadata.index (default false)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ node_id, descriptive }) => {
      const node = await api.getNode(node_id);
      const n = ((node as { result?: { node?: Record<string, unknown> } })?.result?.node ?? node) as Record<string, unknown>;
      const body = typeof n?.content === "string" ? (n.content as string) : "";
      const headings = parseOutline(body);
      const lines: string[] = [`${n?.name} (${node_id}) — ${body.length} chars, ${headings.length} headings`, ""];
      const index = ((n?.metadata as Record<string, unknown>)?.index ?? null) as {
        sections?: Record<string, string>;
        generated_at?: string;
      } | null;
      for (const h of headings) {
        const indent = "  ".repeat(h.level - 1);
        let line = `${indent}${"#".repeat(h.level)} ${h.text}`;
        if (descriptive && index?.sections) {
          const norm = (s: string) => s.replace(/^#+\s*/, "").trim().toLowerCase();
          const key = Object.keys(index.sections).find((k) => norm(k) === norm(h.text));
          if (key) line += ` — ${index.sections[key]}`;
        }
        lines.push(line);
      }
      if (descriptive) {
        lines.push("");
        lines.push(
          index?.generated_at
            ? `(índice descriptivo generado ${index.generated_at}; puede no reflejar cambios posteriores)`
            : "(sin índice descriptivo aún — el wiki-agent lo genera en su run nocturno)"
        );
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  server.registerTool(
    "nodes_search",
    {
      title: "Search Alexandrie nodes",
      description: "Search nodes by title/tags/description. For finding project or service references with content context, prefer nodes_find_refs instead. Use search_content=true to also search bodies and receive content_snippet excerpts.",
      inputSchema: {
        q: z.string().describe("Search query"),
        search_content: z.boolean().optional().describe("Also search inside Markdown content (default: false)"),
        limit: z.number().int().min(1).max(100).optional().describe("Max results (default: 20)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ q, search_content, limit }) => {
      const nodes = await api.searchNodes(q, search_content, limit);
      return { content: [{ type: "text", text: JSON.stringify(nodes, null, 2) }] };
    }
  );

  server.registerTool(
    "nodes_find_refs",
    {
      title: "Find Alexandrie references",
      description: "Search document BODY content and return matching nodes with excerpts. Use this when looking for context about a project, service, CT, or topic — it tells you which wiki docs are relevant without needing to read them fully.",
      inputSchema: {
        q: z.string().describe("Topic, service name, or keyword to find in document bodies"),
        limit: z.number().int().min(1).max(20).optional().describe("Max results (default: 10)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ q, limit }) => {
      const raw = await api.searchNodes(q, true, limit ?? 10) as {
        result: Array<{ id: string; name: string; relevance: number; content_snippet?: string | null }> | null;
      };
      const results = raw?.result ?? [];
      if (!results.length) {
        return { content: [{ type: "text", text: `No references found for "${q}".` }] };
      }
      const lines = results.map(r =>
        `**[${r.id}] ${r.name}** (relevance: ${r.relevance.toFixed(2)})\n` +
        `> ${(r.content_snippet ?? "—").replace(/\n/g, " ").trim()}`
      );
      return { content: [{ type: "text", text: lines.join("\n\n") }] };
    }
  );

  if (profile === "apps") {
    const wikiBrowserHtml = readFileSync(
      new URL("../ui/wiki-browser.html", import.meta.url),
      "utf8"
    );

    registerAppResource(
      server,
      "Alexandrie wiki browser",
      WIKI_BROWSER_URI,
      {
        description: "Interactive, read-only browser for Alexandrie documents.",
        _meta: { ui: { prefersBorder: true } },
      },
      async () => ({
        contents: [
          {
            uri: WIKI_BROWSER_URI,
            mimeType: RESOURCE_MIME_TYPE,
            text: wikiBrowserHtml,
            _meta: { ui: { prefersBorder: true } },
          },
        ],
      })
    );

    registerAppTool(
      server,
      "render_wiki_browser",
      {
        title: "Browse Alexandrie",
        description:
          "Show an interactive, read-only Alexandrie browser. Use a query to show relevant documents, or omit it to show a compact overview.",
        inputSchema: {
          query: z.string().max(200).optional().describe("Search terms for wiki titles and document bodies"),
          limit: z.number().int().min(1).max(20).optional().describe("Maximum documents to show (default 12)"),
        },
        outputSchema: {
          view: z.literal("list"),
          query: z.string(),
          documents: z.array(
            z.object({
              id: z.string(),
              name: z.string(),
              description: z.string().optional(),
              tags: z.string().optional(),
              role: z.number().optional(),
              accessibility: z.number().optional(),
              updated_timestamp: z.number().optional(),
              excerpt: z.string().optional(),
            })
          ),
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: false,
        },
        _meta: {
          ui: { resourceUri: WIKI_BROWSER_URI },
          "openai/toolInvocation/invoking": "Buscando en Alexandrie…",
          "openai/toolInvocation/invoked": "Resultados de Alexandrie listos.",
        },
      },
      async ({ query, limit }) => {
        const documents = await findWikiCards(query, limit ?? 12);
        const structuredContent = {
          view: "list" as const,
          query: query?.trim() ?? "",
          documents,
        };
        return {
          structuredContent,
          content: [
            {
              type: "text",
              text: documents.length
                ? `Found ${documents.length} Alexandrie documents${structuredContent.query ? ` for "${structuredContent.query}"` : ""}.`
                : `No Alexandrie documents found${structuredContent.query ? ` for "${structuredContent.query}"` : ""}.`,
            },
          ],
        };
      }
    );

    registerAppTool(
      server,
      "render_wiki_document",
      {
        title: "Open Alexandrie document",
        description: "Open one Alexandrie document in the interactive read-only viewer by its exact node ID.",
        inputSchema: {
          node_id: z.string().min(1).describe("Exact Alexandrie node ID"),
        },
        outputSchema: {
          view: z.literal("document"),
          document: z.object({
            id: z.string(),
            name: z.string(),
            description: z.string().optional(),
            tags: z.string().optional(),
            content: z.string(),
            updated_timestamp: z.number().optional(),
          }),
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: false,
        },
        _meta: {
          ui: { resourceUri: WIKI_BROWSER_URI },
          "openai/toolInvocation/invoking": "Abriendo documento…",
          "openai/toolInvocation/invoked": "Documento abierto.",
        },
      },
      async ({ node_id }) => {
        const node = unwrapNode(await api.getNode(node_id));
        const document = {
          id: String(node.id ?? node_id),
          name: String(node.name ?? "Untitled"),
          description: typeof node.description === "string" ? node.description : undefined,
          tags: typeof node.tags === "string" ? node.tags : undefined,
          content: typeof node.content === "string" ? node.content : "",
          updated_timestamp: typeof node.updated_timestamp === "number" ? node.updated_timestamp : undefined,
        };
        return {
          structuredContent: { view: "document" as const, document },
          content: [
            {
              type: "text",
              text: `Opened Alexandrie document "${document.name}" (${document.id}).`,
            },
          ],
        };
      }
    );
  }

  if (profile === "full") {
    server.tool(
      "nodes_create",
    "Create a new node. role: 1=workspace 2=category 3=document. accessibility: 0=Public 1=Private 2=Unlisted.",
    {
      name: z.string().describe("Node title (required)"),
      role: z.union([z.literal(1), z.literal(2), z.literal(3)]).describe("1=workspace 2=category 3=document"),
      parent_id: z.string().optional().nullable().describe("Parent node ID; omit or null for root"),
      description: z.string().optional(),
      tags: z.string().optional().describe("Comma-separated tags"),
      content: z.string().optional().describe("Markdown body (for documents)"),
      accessibility: z.union([z.literal(0), z.literal(1), z.literal(2)]).describe("0=Public 1=Private 2=Unlisted"),
      metadata: z
        .record(z.string(), z.any())
        .optional()
        .describe("Optional metadata object. Set {\"render\":\"html\"} to render the node body (raw content) as a sandboxed HTML page instead of Markdown."),
    },
    async (payload) => {
      const node = await api.createNode(payload as api.CreateNodePayload);
      return { content: [{ type: "text", text: `Node created.\n${writeSummary(node)}` }] };
    }
  );

  server.tool(
    "nodes_update",
    "Update an existing node by replacing whole fields (safe read-modify-write; fields not provided are preserved). role: 1=workspace 2=category 3=document. For partial changes to large documents prefer nodes_edit (find-and-replace).",
    {
      node_id: z.string().describe("ID of the node to update"),
      name: z.string().optional(),
      role: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional().describe("1=workspace 2=category 3=document"),
      description: z.string().optional().nullable(),
      tags: z.string().optional().nullable().describe("Comma-separated tags"),
      content: z.string().optional().nullable().describe("New Markdown content"),
      accessibility: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional().describe("0=Public 1=Private 2=Unlisted"),
      parent_id: z.string().optional().nullable().describe("Move node to a different parent"),
      metadata: z
        .record(z.string(), z.any())
        .optional()
        .nullable()
        .describe("Optional metadata object (replaces existing). Set {\"render\":\"html\"} to render the body as a sandboxed HTML page; null clears it."),
    },
    async ({ node_id, ...payload }) => {
      const node = await api.updateNode(node_id, payload as api.UpdateNodePayload);
      return { content: [{ type: "text", text: `Node updated.\n${writeSummary(node)}` }] };
    }
  );

  server.tool(
    "nodes_edit",
    "Edit a document's Markdown content in place via find-and-replace, without resending the whole body. Provide one or more edits applied in order; each old_string must match the current content exactly and be unique (unless replace_all). Edits are applied atomically server-side and content_compiled is recompiled automatically. Prefer this over nodes_update for partial changes to large documents.",
    {
      node_id: z.string().describe("ID of the document to edit"),
      edits: z
        .array(
          z.object({
            old_string: z.string().describe("Exact text to find in the current content"),
            new_string: z.string().describe("Replacement text"),
            replace_all: z.boolean().optional().describe("Replace every occurrence (default false: old_string must be unique)"),
          })
        )
        .min(1)
        .describe("Edits applied sequentially"),
    },
    async ({ node_id, edits }) => {
      const result = await api.editNode(node_id, edits);
      return { content: [{ type: "text", text: `Edited.\n${JSON.stringify(result, null, 2)}` }] };
    }
  );

  server.tool(
    "nodes_delete",
    "Permanently delete a node. This cannot be undone.",
    { node_id: z.string().describe("ID of the node to delete") },
    async ({ node_id }) => {
      const result = await api.deleteNode(node_id);
      return { content: [{ type: "text", text: result.message ?? `Node ${node_id} deleted.` }] };
    }
  );

  server.tool(
    "nodes_append",
    "Append content to an existing document without resending the whole body. Ideal for writing large docs chunk by chunk — avoids the token cost of resending the full content. An optional separator (default: two newlines) is inserted between the existing content and the new chunk.",
    {
      node_id: z.string().describe("ID of the document to append to"),
      content: z.string().describe("Markdown content to append"),
      separator: z.string().optional().describe("Separator inserted between existing and new content (default: two newlines)"),
    },
    async ({ node_id, content, separator }) => {
      const result = await api.appendNode(node_id, content, separator);
      return { content: [{ type: "text", text: `Appended.\n${JSON.stringify(result, null, 2)}` }] };
    }
  );

  server.tool(
    "nodes_create_from_url",
    "Create a new document whose content is fetched directly from a URL (e.g. a raw GitHub file, gist, or hosted HTML page). The server downloads the URL and stores its text as the node content — no need to pass the body through the LLM context.",
    {
      url: z.string().url().describe("URL to fetch the content from"),
      name: z.string().describe("Node title"),
      parent_id: z.string().optional().nullable().describe("Parent node ID"),
      description: z.string().optional(),
      tags: z.string().optional().describe("Comma-separated tags"),
      accessibility: z.union([z.literal(0), z.literal(1), z.literal(2)]).describe("0=Public 1=Private 2=Unlisted"),
      metadata: z.record(z.string(), z.any()).optional().describe("Optional metadata, e.g. {\"render\":\"html\"} to render as HTML page"),
    },
    async ({ url, ...payload }) => {
      const node = await api.createNodeFromUrl(url, { role: 3, ...payload } as Parameters<typeof api.createNodeFromUrl>[1]);
      return { content: [{ type: "text", text: `Node created from URL.\n${writeSummary(node)}` }] };
    }
  );

  // BACKUP
  server.tool(
    "backup_start",
    "Trigger a backup job. Returns a job ID to poll with backup_status.",
    {},
    async () => {
      const job = await api.startBackup();
      return { content: [{ type: "text", text: `Backup started.\n${JSON.stringify(job, null, 2)}` }] };
    }
  );

  server.tool(
    "backup_status",
    "Check the status of a previously started backup job.",
    { job_id: z.string().describe("Job ID returned by backup_start") },
    async ({ job_id }) => {
      const job = await api.getBackupStatus(job_id);
      return { content: [{ type: "text", text: JSON.stringify(job, null, 2) }] };
    }
  );
  }

  return server;
}

// ── Transport selection ───────────────────────────────────────────────────────

// Same rationale as ALEXANDRIE_TOKEN_FILE in client.ts: keep the secret in a
// file so it can be rotated without touching the unit or the env file.
function readTokenFile(envName: "ALEXANDRIE_MCP_AUTH_TOKEN_FILE" | "ALEXANDRIE_MCP_APPS_TOKEN_FILE"): string | null {
  const file = process.env[envName];
  if (!file) return null;
  try {
    const token = readFileSync(file, "utf8").trim();
    return token || null;
  } catch (err) {
    process.stderr.write(`Cannot read ${envName} (${file}): ${err}\n`);
    return null;
  }
}

function tokensMatch(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Clients that only accept a bare URL (the Claude app without the request-header
// beta, mobile, …) cannot send Authorization, so the token is also accepted as a
// /t/<token>/ path prefix. The transport ignores the path, so we just strip it.
const PATH_TOKEN = /^\/t\/([^/]+)(\/.*)?$/;
const APPS_PATH_TOKEN = /^\/apps\/t\/([^/]+)(\/.*)?$/;

function authorize(
  req: http.IncomingMessage,
  fullToken: string,
  appsToken: string | null
): ServerProfile | null {
  const appsMatch = APPS_PATH_TOKEN.exec(req.url ?? "");
  if (appsMatch) {
    if (!appsToken || !tokensMatch(decodeURIComponent(appsMatch[1]), appsToken)) return null;
    req.url = appsMatch[2] || "/mcp";
    return "apps";
  }
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    return tokensMatch(header.slice(7).trim(), fullToken) ? "full" : null;
  }
  const match = PATH_TOKEN.exec(req.url ?? "");
  if (match) {
    if (!tokensMatch(decodeURIComponent(match[1]), fullToken)) return null;
    req.url = match[2] || "/";
    return "full";
  }
  return null;
}

async function startHttp(port: number, authToken: string | null, appsToken: string | null = null) {
  const host = process.env.ALEXANDRIE_MCP_HOST ?? "0.0.0.0";

  const httpServer = http.createServer(async (req, res) => {
    let profile: ServerProfile = "full";
    if (authToken) {
      // Unauthenticated on purpose: lets the tunnel and proxy be verified
      // end to end without handing out the token.
      if (req.method === "GET" && (req.url === "/healthz" || req.url === "/healthz/")) {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("ok\n");
        return;
      }

      // Clients probe /.well-known/oauth-* at the domain root to discover OAuth.
      // Answering 401 there reads as "this server speaks OAuth" and sends them
      // into a client-registration flow that does not exist here, so say 404.
      if (req.url?.startsWith("/.well-known/")) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "not_found" }));
        return;
      }
      const authorizedProfile = authorize(req, authToken, appsToken);
      if (!authorizedProfile) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32001, message: "Unauthorized" },
            id: null,
          })
        );
        return;
      }
      profile = authorizedProfile;
    }

    const mcpServer = buildServer(profile);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
    });
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res);
  });

  await new Promise<void>((resolve) => httpServer.listen(port, host, resolve));
  const mode = authToken
    ? `token required${appsToken ? "; separate Apps token enabled" : ""}`
    : "no auth";
  process.stderr.write(`Alexandrie MCP server listening on http://${host}:${port}/ (${mode})\n`);
}

async function startStdio() {
  const mcpServer = buildServer();
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  process.stderr.write("Alexandrie MCP server running (stdio)\n");
}

async function main() {
  const useStdio = process.argv.includes("--stdio");
  if (useStdio) {
    await startStdio();
    return;
  }

  // Plain listener: unchanged, for LAN and tailnet clients.
  const port = parseInt(process.env.ALEXANDRIE_MCP_PORT ?? "8300", 10);
  await startHttp(port, null);

  // Authenticated listener: only started when a token is actually configured,
  // so the port can never exist without a secret in front of it.
  const authPort = parseInt(process.env.ALEXANDRIE_MCP_AUTH_PORT ?? "", 10);
  if (Number.isFinite(authPort)) {
    const authToken = readTokenFile("ALEXANDRIE_MCP_AUTH_TOKEN_FILE");
    if (authToken) {
      let appsToken = readTokenFile("ALEXANDRIE_MCP_APPS_TOKEN_FILE");
      if (appsToken && tokensMatch(appsToken, authToken)) {
        process.stderr.write(
          "ALEXANDRIE_MCP_APPS_TOKEN_FILE must not contain the full-access token; Apps profile disabled\n"
        );
        appsToken = null;
      }
      await startHttp(authPort, authToken, appsToken);
    } else {
      process.stderr.write(
        `ALEXANDRIE_MCP_AUTH_PORT=${authPort} set but no usable token; authenticated listener not started\n`
      );
    }
  }
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err}\n`);
  process.exit(1);
});
