#!/usr/bin/env node
// Regenera mcp/src/markdown/ a partir del renderer del frontend (FUENTE ÚNICA).
// NO editar mcp/src/markdown/ a mano: este script lo sobrescribe en cada build.
// Aplica los ajustes para Node/NodeNext (el frontend asume Bundler + navegador).
import { readdirSync, readFileSync, writeFileSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)); // mcp/scripts
const SRC = join(here, "..", "..", "frontend", "app", "helpers", "markdown");
const DEST = join(here, "..", "src", "markdown");

if (!existsSync(SRC)) {
  console.error(`[sync-renderer] No existe la carpeta fuente: ${SRC}`);
  console.error("  Debe ejecutarse dentro del monorepo (junto a frontend/).");
  process.exit(1);
}

const HEADER =
  "// GENERATED por mcp/scripts/sync-renderer.mjs — NO EDITAR.\n" +
  "// Fuente única: frontend/app/helpers/markdown/. Se regenera en cada build.\n";

function transform(name, code) {
  // 1) NodeNext exige extensión .js en imports relativos.
  code = code.replace(/from '(\.\/[\w-]+)'/g, "from '$1.js'");

  // 2) code-block.ts: el frontend adjunta a nivel de módulo un listener de click
  //    (document/navigator) que rompe en Node. El MCP solo genera HTML → se omite.
  if (name === "code-block.ts") {
    const before = code;
    code = code.replace(
      /\ndocument\.addEventListener\('click',[\s\S]*?\}\);\s*$/,
      "\n// (listener de copia omitido: solo aplica en navegador; el MCP genera el HTML)\n"
    );
    if (code === before) {
      console.error("[sync-renderer] AVISO: no se encontró el listener DOM en code-block.ts (¿cambió el frontend?). Revisar.");
    }
  }

  // 3) index.ts: el tipo de markdown-it-highlightjs no casa con PluginSimple bajo NodeNext.
  if (name === "index.ts") {
    code = code.replace(/md\.use\(highlight\);/, "md.use(highlight as any); // tipos no casan en NodeNext; runtime ok");
  }

  return HEADER + code;
}

rmSync(DEST, { recursive: true, force: true });
mkdirSync(DEST, { recursive: true });

let n = 0;
for (const f of readdirSync(SRC)) {
  if (!f.endsWith(".ts")) continue;
  writeFileSync(join(DEST, f), transform(f, readFileSync(join(SRC, f), "utf8")));
  n++;
}
console.log(`[sync-renderer] ${n} ficheros regenerados en src/markdown/ desde el frontend.`);
