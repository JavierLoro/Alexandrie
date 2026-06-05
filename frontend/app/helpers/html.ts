import DOMPurify from 'dompurify';

/**
 * Procesa un archivo .html subido para crear un nodo.
 * Extrae el contenido del <body> (DOMParser envuelve también los fragmentos en
 * <body>, así que sirve tanto para documentos completos como para fragmentos
 * sueltos) y lo sanea con DOMPurify.
 *
 * Client-only: usa APIs de navegador (DOMParser / DOMPurify). Solo se invoca
 * desde handlers de subida.
 *
 * `content_compiled` SIEMPRE se sanea: es lo que se renderiza same-origin (vía
 * v-html) en snippets de búsqueda, SEO y el visor de admin, así que no debe
 * contener scripts ni atributos de evento. La fidelidad completa del HTML
 * (head/style/script) se preserva en `content`, que solo se renderiza dentro
 * del iframe sandbox de ContentCompiled.vue. No hacer esto opcional: el saneado
 * no puede depender de una preferencia del propio usuario que sube el archivo.
 *
 * @returns content = documento HTML completo e intacto (fuente del iframe);
 *          content_compiled = body saneado para snippets/SEO/preview same-origin.
 */
export function processHtmlUpload(raw: string): { content: string; content_compiled: string } {
  const body = new DOMParser().parseFromString(raw, 'text/html').body.innerHTML;
  return { content: raw, content_compiled: DOMPurify.sanitize(body) };
}
