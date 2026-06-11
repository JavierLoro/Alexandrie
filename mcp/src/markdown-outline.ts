// Utilidades de outline de Markdown: extracción de headings y rangos de sección.
// Ignora headings dentro de code fences (``` / ~~~).

export interface Heading {
  level: number;
  text: string;
  line: number; // 0-based
}

const FENCE_RE = /^(\s{0,3})(`{3,}|~{3,})/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;

export function parseOutline(content: string): Heading[] {
  const lines = content.split("\n");
  const headings: Heading[] = [];
  let fence: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = line.match(FENCE_RE);
    if (fenceMatch) {
      const marker = fenceMatch[2][0].repeat(3);
      if (fence === null) fence = marker;
      else if (line.trim().startsWith(fence)) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const m = line.match(HEADING_RE);
    if (m) headings.push({ level: m[1].length, text: m[2].trim(), line: i });
  }
  return headings;
}

export function formatOutline(headings: Heading[]): string {
  if (headings.length === 0) return "(sin headings)";
  return headings.map((h) => `${"  ".repeat(h.level - 1)}${"#".repeat(h.level)} ${h.text}`).join("\n");
}

function normalize(s: string): string {
  return s.replace(/^#+\s*/, "").trim().toLowerCase();
}

// Devuelve el rango de líneas [start, end) de la sección cuyo heading coincide
// (case-insensitive, con o sin '#'). La sección termina en el siguiente heading
// de nivel <= al suyo. Lanza Error con candidatos si hay 0 o >1 coincidencias.
export function sectionRange(content: string, heading: string): { start: number; end: number; heading: Heading } {
  const headings = parseOutline(content);
  const wanted = normalize(heading);
  const matches = headings.filter((h) => normalize(h.text) === wanted);

  if (matches.length === 0) {
    throw new Error(`Heading "${heading}" not found. Document outline:\n${formatOutline(headings)}`);
  }
  if (matches.length > 1) {
    const list = matches.map((h) => `line ${h.line + 1}: ${"#".repeat(h.level)} ${h.text}`).join("\n");
    throw new Error(`Heading "${heading}" is ambiguous (${matches.length} matches):\n${list}`);
  }

  const target = matches[0];
  const lines = content.split("\n");
  let end = lines.length;
  for (const h of headings) {
    if (h.line > target.line && h.level <= target.level) {
      end = h.line;
      break;
    }
  }
  return { start: target.line, end, heading: target };
}

export function extractSection(content: string, heading: string): { text: string; startLine: number; endLine: number } {
  const { start, end } = sectionRange(content, heading);
  const lines = content.split("\n");
  return { text: lines.slice(start, end).join("\n").trimEnd(), startLine: start + 1, endLine: end };
}
