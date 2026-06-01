<template>
  <div class="container">
    <EditorAppHeader icon="image" :title="t('markdown.image.title')" :subtitle="t('markdown.image.subtitle')" />
    <div class="content">
      <AppDrop ref="dropComponent" :multiple="true" :max-files="10" @select="onFilesSelected" />
      <AppButton
        v-if="pendingFiles.length && !isLoading"
        type="primary"
        style="width: 100%; margin-top: -8px"
        @click="submitFiles"
      >
        Upload {{ pendingFiles.length }} file{{ pendingFiles.length !== 1 ? 's' : '' }}
      </AppButton>
      <Loader v-if="isLoading" style="margin: 12px auto" />
      <p v-if="uploadError" class="error">{{ uploadError }}</p>
      <div class="search-bar">
        <input v-model="searchQuery" :placeholder="t('markdown.image.searchPlaceholder')" />
      </div>
      <div class="images-grid">
        <div v-for="image in filteredImages.values()" :key="image.id" class="image-item" @click="selectImage(image)">
          <img :src="resolvePreviewUrl(image)" :alt="image.name" class="image-preview" @error="handleImageError" />
          <div class="image-info">
            <span class="image-name">{{ image.name }}</span>
            <span class="image-size">{{ readableFileSize(image.size ?? 0) }}</span>
          </div>
        </div>
      </div>

      <div v-if="filteredImages.size === 0" class="no-images">
        <p>{{ t('markdown.image.noImages') }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import EditorAppHeader from './EditorAppHeader.vue';
import { readableFileSize, isImageFile, resolvePreviewUrl } from '~/helpers/resources';
import type { Node } from '~/stores';

const { t } = useI18nT();
const resourcesStore = useResourcesStore();
const nodesStore = useNodesStore();

const props = defineProps<{ onImageSelect: (imageUrl: string, altText: string) => void; nodeId?: string }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const searchQuery = ref('');
const isLoading = ref(false);
const uploadError = ref<string | null>(null);
const pendingFiles = ref<File[]>([]);
const dropComponent = ref();
const { resourceURL } = useApi();

const onFilesSelected = (files: File | File[] | null) => {
  if (!files) {
    pendingFiles.value = [];
  } else if (Array.isArray(files)) {
    pendingFiles.value = files;
  } else {
    pendingFiles.value = [files];
  }
};

const submitFiles = async () => {
  if (!pendingFiles.value.length) return;
  isLoading.value = true;
  uploadError.value = null;
  const filesToUpload = [...pendingFiles.value];
  pendingFiles.value = [];
  dropComponent.value.reset();
  for (const file of filesToUpload) {
    const body = new FormData();
    body.append('parent_id', props.nodeId || '');
    body.append('file', file);
    await resourcesStore.post(body).catch(e => (uploadError.value = e || t('markdown.image.uploadError')));
  }
  isLoading.value = false;
};

const filteredImages = computed(() => {
  if (!searchQuery.value.trim()) {
    return nodesStore.resources.filter(img => isImageFile(img.metadata?.filetype as string));
  }
  return nodesStore.resources.filter(img => isImageFile(img.metadata?.filetype as string) && img.name.toLowerCase().includes(searchQuery.value.toLowerCase()));
});

const handleImageError = (event: Event) => {
  const img = event.target as HTMLImageElement;
  img.style.display = 'none';
};

const selectImage = (image: Node) => {
  const altText = image.name.replace(/\.[^/.]+$/, '');
  props.onImageSelect(resourceURL(image), altText);
  emit('close');
};
</script>

<style scoped lang="scss">
.container {
  display: flex;
  flex-direction: column;
}

.content {
  min-height: 0;
  padding: 0;
  gap: 24px;
  overflow-y: auto;
  padding-right: 8px;
}

.search-bar {
  padding: 16px 0;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.images-grid {
  display: grid;
  padding: 16px 0;
  flex: 1;
  gap: 16px;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
}

.image-item {
  border: 2px solid transparent;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition:
    border-color $transition-fast ease,
    box-shadow $transition-fast ease,
    transform $transition-fast ease;

  &:hover {
    border-color: var(--primary);
    box-shadow: var(--shadow-lg);
    transform: translateY(-2px);
  }

  .image-preview {
    width: 100%;
    height: 150px;
    border-radius: var(--radius-sm);
  }

  .image-info {
    padding: 12px;

    .image-name {
      display: block;
      font-size: 14px;
      font-weight: 500;
      color: var(--text-primary);
      margin-bottom: 4px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .image-size {
      display: block;
      font-size: 12px;
      color: var(--text-secondary);
    }
  }
}

.no-images {
  display: flex;
  height: 200px;
  font-size: 16px;
  color: var(--text-secondary);
  align-items: center;
  justify-content: center;
}
</style>
