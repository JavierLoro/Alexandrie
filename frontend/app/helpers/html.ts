import DOMPurify from 'dompurify';

/**
 * Procesa un archivo .html subido para crear un nodo.
 * Extrae el contenido del <body> (DOMParser envuelve también los fragmentos en
 * <body>, así que sirve tanto para documentos completos como para fragmentos
 * sueltos) y opcionalmente lo sanea con DOMPurify.
 *
 * Client-only: usa APIs de navegador (DOMParser / DOMPurify). Solo se invoca
 * desde handlers de subida.
 *
 * @returns content = documento HTML completo e intacto (head/style/script);
 *          content_compiled = body saneado para snippets/SEO (saneado si sanitize=true).
 */
export function processHtmlUpload(raw: string, sanitize = true): { content: string; content_compiled: string } {
  const body = new DOMParser().parseFromString(raw, 'text/html').body.innerHTML;
  // content = documento HTML completo e intacto (head/style/script) -> fuente del iframe de render.
  // content_compiled = solo el body saneado, para snippets de busqueda / SEO / hasContent.
  return { content: raw, content_compiled: sanitize ? DOMPurify.sanitize(body) : body };
}
