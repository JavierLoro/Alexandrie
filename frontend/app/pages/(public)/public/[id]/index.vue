<template>
  <div v-if="!error && article" class="fullpage">
    <NodeDocumentContentCompiled :node="article" standalone />
  </div>

  <div v-else-if="!error" class="fullpage-loading">
    <NodeDocumentSkeleton />
  </div>

  <Error v-else :error="error?.message" />
</template>

<script setup lang="ts">
import NodeDocumentContentCompiled from '~/components/Node/Document/ContentCompiled.vue';
import type { Node } from '~/stores';

definePageMeta({ layout: false });

const documentsStore = useNodesStore();
const route = useRoute();
const runtimeConfig = useRuntimeConfig();

const { data: article, error } = await useAsyncData(`public-html-${route.params.id}`, async (): Promise<Node | undefined> => {
  const id = route.params.id;
  if (!id || typeof id !== 'string') return undefined;
  const result = await documentsStore.fetchPublic(id);
  if (!result) return undefined;
  // /public/:id es exclusivamente para docs HTML — redirige el resto a /doc/:id
  if (result.node.metadata?.render !== 'html') {
    await navigateTo(`/doc/${id}`);
    return undefined;
  }
  return result.node;
});

const title = computed(() => article.value?.name || 'Document');
const description = computed(() => article.value?.description || 'Public document published on Alexandrie.');
const baseUrl = runtimeConfig.public.baseUrl || 'https://alexandrie-hub.fr';
const canonicalUrl = computed(() => `${baseUrl}/public/${route.params.id}`);
const ogImage = computed(() => (article.value?.thumbnail ? `${baseUrl}${article.value.thumbnail}` : `${baseUrl}/og/default-article.png`));

useSeoMeta({
  title,
  description,
  keywords: () => article.value?.tags,

  ogTitle: title,
  ogDescription: description,
  ogType: 'article',
  ogUrl: canonicalUrl,
  ogImage,

  articlePublishedTime: () => (article.value ? new Date(article.value.created_timestamp).toISOString() : undefined),
  articleModifiedTime: () => (article.value ? new Date(article.value.updated_timestamp).toISOString() : undefined),

  twitterCard: 'summary_large_image',
  twitterTitle: title,
  twitterDescription: description,
  twitterImage: ogImage,
});
</script>

<style scoped lang="scss">
.fullpage {
  width: 100%;
  height: 100dvh;
  overflow: hidden;
}

.fullpage-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100dvh;
  padding: 2rem;
}
</style>
