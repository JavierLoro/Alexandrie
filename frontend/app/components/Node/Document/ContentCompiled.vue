<template>
  <!-- eslint-disable vue/no-v-html -->
  <iframe
    v-if="isHtmlDoc"
    ref="htmlFrame"
    class="html-doc-frame"
    sandbox="allow-scripts allow-popups allow-modals allow-forms"
    :srcdoc="htmlSrcdoc"
    :style="{ height: frameHeight }"
  />
  <article
    v-else
    ref="rootElement"
    :class="['markdown-preview', `${theme}-theme`, `document-content`]"
    :style="{ fontSize: documentFontSize + 'px', fontFamily: documentFontFamily, lineHeight: documentLineHeight }"
    v-html="node?.content_compiled"
  />
</template>

<script setup lang="ts">
import type { Node } from '~/stores';
import { subscribeDrawioCacheInvalidated } from '~/composables/useDrawioCache';
import { rerenderImages } from '~/helpers/DOM';

const props = defineProps<{ node?: Partial<Node> }>();

const preferences = usePreferencesStore();

const theme = computed(() => {
  if (props.node?.theme) return props.node.theme;
  return preferences.get('theme').value;
});
const documentFontSize = preferences.get('documentFontSize');
const documentFontFamily = preferences.get('documentFontFamily');
const documentLineHeight = preferences.get('documentLineHeight');

const rootElement = ref<HTMLElement>();

// --- Documentos HTML (metadata.render === 'html') ------------------------
// Se renderizan en un iframe aislado (sandbox sin allow-same-origin) para
// ejecutar su propio CSS y JS sin acceso al origen del wiki (cookies/sesión).
const isHtmlDoc = computed(() => props.node?.metadata?.render === 'html');
const htmlFrame = ref<HTMLIFrameElement>();
const frameHeight = ref('300px');

// Headings reportados por el iframe (para el TOC, ver Fix 3). Texto sin sanear aquí: el
// consumidor (Node/TOC/Level.vue) lo pinta con interpolación `{{ }}`, nunca con v-html.
interface IframeHeading {
  level: number;
  text: string;
  id: string;
}
const headings = ref<IframeHeading[]>([]);

// Tope de altura del iframe HTML: acota el ajuste automático para que `min-height:100vh`
// (que se resolvería contra la propia altura del iframe) no entre en un bucle de crecimiento
// sin fin. Al fijar la altura, el contenido más alto hace scroll interno. Se calcula en
// onMounted (window no existe en SSR) y se recalcula al redimensionar la ventana.
const maxFrameHeightPx = ref(2000);

// Pide al iframe que haga scroll hasta un heading (navegación del TOC vía postMessage,
// porque el sandbox sin allow-same-origin impide manipular su DOM desde el padre).
function scrollToHeading(id: string) {
  htmlFrame.value?.contentWindow?.postMessage({ type: 'alexandrie-scroll-to', id }, '*');
}

defineExpose({ rootElement, headings, scrollToHeading });

// Snippet inyectado en el iframe que reporta su altura y sus headings al padre vía
// postMessage, y escucha peticiones de scroll a un heading (navegación del TOC).
const RESIZE_SNIPPET = `
<script>
(function () {
  function send() {
    var h = Math.max(
      document.documentElement.scrollHeight || 0,
      document.body ? document.body.scrollHeight : 0
    );
    parent.postMessage({ type: 'alexandrie-iframe-height', height: h }, '*');
  }
  function sendHeadings() {
    var els = document.querySelectorAll('h1,h2,h3,h4,h5,h6');
    var out = [];
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (!el.id) el.id = 'alexandrie-h-' + i;
      out.push({ level: parseInt(el.tagName.charAt(1), 10), text: (el.textContent || '').trim(), id: el.id });
    }
    parent.postMessage({ type: 'alexandrie-iframe-headings', headings: out }, '*');
  }
  window.addEventListener('load', send);
  window.addEventListener('resize', send);
  window.addEventListener('load', sendHeadings);
  if (window.ResizeObserver) new ResizeObserver(send).observe(document.documentElement);
  window.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'alexandrie-scroll-to' && e.data.id) {
      var t = document.getElementById(e.data.id);
      if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
  setTimeout(send, 100);
  setTimeout(send, 600);
  setTimeout(sendHeadings, 600);
})();
<\u002fscript>`;

const htmlSrcdoc = computed(() => {
  if (!isHtmlDoc.value) return '';
  const raw = props.node?.content || '';
  // Inyecta el snippet de auto-altura antes de </body> (o al final si no existe).
  if (/<\/body>/i.test(raw)) return raw.replace(/<\/body>/i, `${RESIZE_SNIPPET}</body>`);
  return raw + RESIZE_SNIPPET;
});

function onFrameMessage(e: MessageEvent) {
  if (!e.data) return;
  // Solo aceptamos mensajes de nuestro propio iframe.
  if (htmlFrame.value && e.source !== htmlFrame.value.contentWindow) return;
  if (e.data.type === 'alexandrie-iframe-height') {
    const h = Number(e.data.height);
    // Clamp: corta el bucle de crecimiento y deja que el contenido más alto haga scroll interno.
    if (Number.isFinite(h) && h > 0) frameHeight.value = `${Math.min(h, maxFrameHeightPx.value)}px`;
  } else if (e.data.type === 'alexandrie-iframe-headings') {
    headings.value = Array.isArray(e.data.headings) ? e.data.headings : [];
  }
}

function updateMaxFrameHeight() {
  maxFrameHeightPx.value = Math.round(window.innerHeight * 0.85);
}

onMounted(() => {
  updateMaxFrameHeight();
  window.addEventListener('resize', updateMaxFrameHeight);
  window.addEventListener('message', onFrameMessage);
  const unsub = subscribeDrawioCacheInvalidated(() => {
    if (rootElement.value) rerenderImages(rootElement.value);
  });
  onUnmounted(() => {
    window.removeEventListener('resize', updateMaxFrameHeight);
    window.removeEventListener('message', onFrameMessage);
    unsub();
  });
});
</script>

<style lang="scss" scoped>
article {
  max-width: 100%;
}
.html-doc-frame {
  width: 100%;
  border: 0;
  display: block;
  min-height: 300px;
}
</style>
