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

defineExpose({ rootElement });

// --- Documentos HTML (metadata.render === 'html') ------------------------
// Se renderizan en un iframe aislado (sandbox sin allow-same-origin) para
// ejecutar su propio CSS y JS sin acceso al origen del wiki (cookies/sesión).
const isHtmlDoc = computed(() => props.node?.metadata?.render === 'html');
const htmlFrame = ref<HTMLIFrameElement>();
const frameHeight = ref('300px');

// Snippet inyectado en el iframe que reporta su altura al padre vía postMessage.
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
  window.addEventListener('load', send);
  window.addEventListener('resize', send);
  if (window.ResizeObserver) new ResizeObserver(send).observe(document.documentElement);
  setTimeout(send, 100);
  setTimeout(send, 600);
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
  if (!e.data || e.data.type !== 'alexandrie-iframe-height') return;
  if (htmlFrame.value && e.source !== htmlFrame.value.contentWindow) return;
  const h = Number(e.data.height);
  if (Number.isFinite(h) && h > 0) frameHeight.value = `${h}px`;
}

onMounted(() => {
  window.addEventListener('message', onFrameMessage);
  const unsub = subscribeDrawioCacheInvalidated(() => {
    if (rootElement.value) rerenderImages(rootElement.value);
  });
  onUnmounted(() => {
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
