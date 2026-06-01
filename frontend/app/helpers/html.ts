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
 * @returns content = HTML crudo del body (fuente editable);
 *          content_compiled = HTML para renderizar (saneado si sanitize=true).
 */
export function processHtmlUpload(raw: string, sanitize = true): { content: string; content_compiled: string } {
  const body = new DOMParser().parseFromString(raw, 'text/html').body.innerHTML;
  return { content: body, content_compiled: sanitize ? DOMPurify.sanitize(body) : body };
}
