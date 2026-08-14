---
name: alexandrie-wiki
description: Busca, navega y lee documentación en una wiki Alexandrie conectada mediante MCP. Usar cuando el usuario quiera encontrar decisiones, proyectos, servicios o referencias guardadas en Alexandrie, o abrir el navegador visual de la wiki.
---

# Usar Alexandrie Wiki

1. Buscar primero por contenido con `nodes_find_refs`; usar `nodes_search` para títulos, etiquetas o descripciones.
2. Obtener `nodes_outline` antes de leer un documento grande y pedir solo la sección necesaria con `nodes_get`.
3. Usar `render_wiki_browser` cuando una lista visual ayude a comparar o navegar resultados; usar `render_wiki_document` para abrir un documento concreto.
4. Conservar los IDs estables de los nodos en los seguimientos.
5. Tratar este perfil como solo lectura. No afirmar que se ha editado, creado o eliminado contenido.
