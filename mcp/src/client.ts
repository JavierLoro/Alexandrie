import compile from "./markdown/index.js";

const BASE_URL = process.env.ALEXANDRIE_BASE_URL ?? "http://localhost:8201";

function compileMarkdown(src: string): string {
  return compile(src);
}

// ── Strip content_compiled from API responses (not needed by LLM consumers) ───

function stripCompiled(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(stripCompiled);
  if (obj !== null && typeof obj === "object") {
    const result = { ...(obj as Record<string, unknown>) };
    delete result["content_compiled"];
    for (const key of Object.keys(result)) result[key] = stripCompiled(result[key]);
    return result;
  }
  return obj;
}

export type NodeRole = 1 | 2 | 3; // 1=workspace, 2=category, 3=document
export type Accessibility = 0 | 1 | 2; // 0=Public, 1=Private, 2=Unlisted

export interface AlexandrieNode {
  id: string;
  user_id: string;
  parent_id: string | null;
  name: string;
  description?: string | null;
  tags?: string | null;
  role: number;
  color?: number | null;
  icon?: string | null;
  thumbnail?: string | null;
  theme?: string | null;
  content?: string | null;
  content_compiled?: string | null;
  accessibility: number | null;
  access?: number;
  display?: number | null;
  order?: number | null;
  size?: number | null;
  metadata?: unknown;
  created_timestamp?: number;
  updated_timestamp?: number;
}

export interface CreateNodePayload {
  name: string;
  role: NodeRole;
  parent_id?: string | null;
  description?: string;
  tags?: string;
  content?: string;
  accessibility: Accessibility;
  metadata?: Record<string, unknown> | null;
}

export interface UpdateNodePayload {
  name?: string;
  role?: NodeRole;
  description?: string | null;
  tags?: string | null;
  content?: string | null;
  accessibility?: Accessibility;
  parent_id?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface BackupJob {
  id: string;
  status: string;
  created_at?: number;
  finished_at?: number;
  error?: string;
}

function getToken(): string {
  const token = process.env.ALEXANDRIE_TOKEN;
  if (!token) throw new Error("ALEXANDRIE_TOKEN environment variable is not set");
  return token;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  token?: string
): Promise<T> {
  const authToken = token ?? getToken();
  const url = `${BASE_URL}${path}`;

  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Cookie: `Authorization=${authToken}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Alexandrie API error ${res.status} ${res.statusText}: ${text}`);
  }

  const text = await res.text();
  return text ? (JSON.parse(text) as T) : ({} as T);
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export async function login(username: string, password: string): Promise<{ access_token: string }> {
  const res = await fetch(`${BASE_URL}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Login failed ${res.status}: ${text}`);
  }
  const cookie = res.headers.get("set-cookie") ?? "";
  const match = cookie.match(/Authorization=([^;]+)/);
  if (!match) throw new Error("No Authorization cookie in login response");
  return { access_token: match[1] };
}

// ── Nodes ─────────────────────────────────────────────────────────────────────

export async function listNodes(userId?: string): Promise<unknown> {
  const res = userId
    ? await request<unknown>("GET", `/api/nodes/user/${userId}`)
    : await request<unknown>("GET", "/api/nodes/me");
  return stripCompiled(res);
}

export async function getNode(nodeId: string): Promise<unknown> {
  const res = await request<unknown>("GET", `/api/nodes/${nodeId}`);
  return stripCompiled(res);
}

export async function searchNodes(
  q: string,
  content?: boolean,
  limit?: number
): Promise<unknown> {
  const params = new URLSearchParams({ q });
  if (content !== undefined) params.set("content", String(content));
  if (limit !== undefined) params.set("limit", String(limit));
  const res = await request<unknown>("GET", `/api/nodes/search?${params}`);
  return stripCompiled(res);
}

export async function createNode(payload: CreateNodePayload): Promise<unknown> {
  const body = { ...payload } as Record<string, unknown>;
  if (payload.content) body["content_compiled"] = compileMarkdown(payload.content);
  const res = await request<unknown>("POST", "/api/nodes", body);
  return stripCompiled(res);
}

export async function updateNode(nodeId: string, payload: UpdateNodePayload): Promise<unknown> {
  const body = { ...payload } as Record<string, unknown>;
  if (payload.content) body["content_compiled"] = compileMarkdown(payload.content);
  const res = await request<unknown>("PATCH", `/api/nodes/${nodeId}`, body);
  return stripCompiled(res);
}

export interface NodeEdit {
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

// Find-and-replace edit of a document's content (server-side, atomic).
// Recompiles content_compiled via updateNode. Mirrors the local Edit tool semantics.
export async function editNode(nodeId: string, edits: NodeEdit[]): Promise<unknown> {
  const res = (await getNode(nodeId)) as { result?: { node?: { content?: string | null } } };
  const node = res?.result?.node;
  if (!node) throw new Error(`Node ${nodeId} not found`);
  let content = node.content;
  if (content == null) throw new Error(`Node ${nodeId} has no textual content to edit`);

  let replacements = 0;
  edits.forEach((e, i) => {
    if (e.old_string === e.new_string) throw new Error(`Edit #${i + 1}: old_string and new_string are identical`);
    const count = content!.split(e.old_string).length - 1;
    if (count === 0) throw new Error(`Edit #${i + 1}: old_string not found in content`);
    if (count > 1 && !e.replace_all)
      throw new Error(`Edit #${i + 1}: old_string is not unique (${count} matches); add more context or set replace_all`);
    content = e.replace_all
      ? content!.split(e.old_string).join(e.new_string)
      : content!.replace(e.old_string, e.new_string);
    replacements += e.replace_all ? count : 1;
  });

  await updateNode(nodeId, { content });
  return { node_id: nodeId, edits_applied: edits.length, replacements, new_length: content.length };
}

export async function deleteNode(nodeId: string): Promise<{ message: string }> {
  return request<{ message: string }>("DELETE", `/api/nodes/${nodeId}`);
}

// Append content to an existing document without resending the whole body.
export async function appendNode(
  nodeId: string,
  content: string,
  separator: string = "\n\n"
): Promise<unknown> {
  const res = (await getNode(nodeId)) as { result?: { node?: { content?: string | null } } };
  const node = res?.result?.node;
  if (!node) throw new Error(`Node ${nodeId} not found`);
  const existing = node.content ?? "";
  const newContent = existing ? existing + separator + content : content;
  await updateNode(nodeId, { content: newContent });
  return { node_id: nodeId, appended_chars: content.length, new_length: newContent.length };
}

// Create a node whose content is fetched from a URL.
export async function createNodeFromUrl(
  url: string,
  payload: Omit<CreateNodePayload, "content">
): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch URL ${url}: ${res.status} ${res.statusText}`);
  const content = await res.text();
  return createNode({ ...payload, content });
}

// ── Backup ────────────────────────────────────────────────────────────────────

export async function startBackup(): Promise<BackupJob> {
  return request<BackupJob>("POST", "/api/backup");
}

export async function getBackupStatus(jobId: string): Promise<BackupJob> {
  return request<BackupJob>("GET", `/api/backup/${jobId}`);
}
