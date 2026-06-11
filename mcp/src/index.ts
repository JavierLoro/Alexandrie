import http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import * as api from "./client.js";

// ── Tool definitions ──────────────────────────────────────────────────────────

function buildServer(): McpServer {
  const server = new McpServer({ name: "alexandrie", version: "1.4.0" });

  // AUTH
  server.tool(
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
  server.tool(
    "nodes_list",
    "List all nodes (workspaces, categories, documents) belonging to a user. Omit user_id to list nodes of the authenticated user.",
    { user_id: z.string().optional().describe("User ID whose nodes to retrieve (omit for current user)") },
    async ({ user_id }) => {
      const nodes = await api.listNodes(user_id);
      return { content: [{ type: "text", text: JSON.stringify(nodes, null, 2) }] };
    }
  );

  server.tool(
    "nodes_get",
    "Get a single node by ID, including its full Markdown content.",
    { node_id: z.string().describe("Node ID") },
    async ({ node_id }) => {
      const node = await api.getNode(node_id);
      return { content: [{ type: "text", text: JSON.stringify(node, null, 2) }] };
    }
  );

  server.tool(
    "nodes_search",
    "Search nodes by title/tags/description. For finding project or service references with content context, prefer nodes_find_refs instead. Use search_content=true to also search bodies and receive content_snippet excerpts.",
    {
      q: z.string().describe("Search query"),
      search_content: z.boolean().optional().describe("Also search inside Markdown content (default: false)"),
      limit: z.number().int().min(1).max(100).optional().describe("Max results (default: 20)"),
    },
    async ({ q, search_content, limit }) => {
      const nodes = await api.searchNodes(q, search_content, limit);
      return { content: [{ type: "text", text: JSON.stringify(nodes, null, 2) }] };
    }
  );

  server.tool(
    "nodes_find_refs",
    "Search document BODY content and return matching nodes with excerpts. Use this when looking for context about a project, service, CT, or topic — it tells you which wiki docs are relevant without needing to read them fully.",
    {
      q: z.string().describe("Topic, service name, or keyword to find in document bodies"),
      limit: z.number().int().min(1).max(20).optional().describe("Max results (default: 10)"),
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
      return { content: [{ type: "text", text: `Node created.\n${JSON.stringify(node, null, 2)}` }] };
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
      return { content: [{ type: "text", text: `Node updated.\n${JSON.stringify(node, null, 2)}` }] };
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
      return { content: [{ type: "text", text: `Node created from URL.\n${JSON.stringify(node, null, 2)}` }] };
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

  return server;
}

// ── Transport selection ───────────────────────────────────────────────────────

async function startHttp(port: number) {
  const httpServer = http.createServer(async (req, res) => {
    const mcpServer = buildServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
    });
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res);
  });

  await new Promise<void>((resolve) => httpServer.listen(port, "0.0.0.0", resolve));
  process.stderr.write(`Alexandrie MCP server listening on http://0.0.0.0:${port}/\n`);
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
  } else {
    const port = parseInt(process.env.ALEXANDRIE_MCP_PORT ?? "8300", 10);
    await startHttp(port);
  }
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err}\n`);
  process.exit(1);
});
