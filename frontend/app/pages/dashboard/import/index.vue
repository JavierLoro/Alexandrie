<template>
  <div class="import-page page-card">
    <!-- Step 1: File Selection -->
    <div v-if="step === 'select'">
      <header>
        <h1 style="font-size: 20px">{{ t('import.meta.title') }} <tag class="orange">Beta</tag></h1>
      </header>
      <p>
        {{ t('import.meta.description') }}
        <NuxtLink to="/dashboard/settings?p=backup" style="color: var(--primary)">{{ t('import.meta.settingsLink') }}</NuxtLink
        >.
      </p>
      <AppDrop ref="dropComponent" :multiple="true" :max-files="50" @select="handleFileSelect" />
      <div class="submit">
        <AppButton type="primary" :disabled="!selectedFiles.length || isAnalyzing" @click="analyzeFile">
          {{ isAnalyzing ? t('import.steps.select.analyzing') : t('import.steps.select.startImport') }}
        </AppButton>
      </div>
      <p v-if="analyzeError" class="error-text">{{ analyzeError }}</p>
    </div>

    <!-- Step 2: Preview & Import (backup files only) -->
    <template v-if="step === 'preview' && manifest">
      <!-- Backup Info Card -->
      <ImportHeader :manifest="manifest" :reset-import="resetImport" />

      <!-- Import Summary -->
      <SummaryCard :to-create="toCreate.length" :to-update="toUpdate.length" :unchanged-count="unchangedCount" :import-job="importJob" />

      <!-- Tabs for New / Updates -->
      <ImportTabs
        :manifest="manifest"
        :to-create="toCreate"
        :to-update="toUpdate"
        :import-job="importJob"
        @import="importNodes"
        @import-local-settings="importLocalSettings"
      />

      <!-- Import All Actions -->
      <ImportActions
        v-model:preserve-timestamps="importOptions.preserveTimestamps"
        v-model:skip-existing="importOptions.skipExisting"
        :to-create="toCreate"
        :to-update="toUpdate"
        :reset-import="resetImport"
        :import-all="importAll"
        :import-job="importJob"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import ImportHeader from './_components/ImportHeader.vue';
import SummaryCard from './_components/ImportSummary.vue';
import ImportTabs from './_components/ImportTabs.vue';
import ImportActions from './_components/ImportActions.vue';
import { handleBackupFile } from '~/helpers/backups';
import type { Manifest } from '~/helpers/backups/types';
import type { DB_Node, ImportJob } from '~/stores/db_strustures';
import compile from '~/helpers/markdown';

definePageMeta({ breadcrumb: { i18n: 'import.meta.breadcrumb' } });

const { t } = useI18nT();
const nodesStore = useNodesStore();
const notifications = useNotifications();

// State
const step = ref<'select' | 'preview'>('select');
const selectedFiles = ref<File[]>([]);
const dropComponent = ref<{ reset: () => void } | null>(null);
const isAnalyzing = ref(false);
const analyzeError = ref('');

// Backup data
const manifest = ref<Manifest | null>(null);
const backupDocuments = ref<DB_Node[]>([]);
const toCreate = ref<DB_Node[]>([]);
const toUpdate = ref<DB_Node[]>([]);
const localData = ref<object | null>(null);

// Import state
const importJob = ref<ImportJob>({
  status: 'pending',
  toCreate: 0,
  toUpdate: 0,
  created: [],
  updated: [],
  failures: 0,
});

// Options
const importOptions = reactive({
  preserveTimestamps: false,
  skipExisting: false,
});

// Computed
const unchangedCount = computed(() => {
  if (!backupDocuments.value.length) return 0;
  return backupDocuments.value.length - toCreate.value.length - toUpdate.value.length;
});

// Methods
const handleFileSelect = (payload?: File | File[] | null) => {
  selectedFiles.value = payload ? (Array.isArray(payload) ? payload : [payload]) : [];
  analyzeError.value = '';
};

async function analyzeFile() {
  if (!selectedFiles.value.length) return;

  isAnalyzing.value = true;
  analyzeError.value = '';

  const mdFiles = selectedFiles.value.filter(f => f.name.endsWith('.md'));
  const backupFiles = selectedFiles.value.filter(f => !f.name.endsWith('.md'));

  try {
    if (mdFiles.length) {
      // One or many markdown files — import directly, no preview step.
      // Precompile content_compiled so the rendered preview shows without opening the editor.
      const now = Date.now();
      const markdownNodes: DB_Node[] = await Promise.all(
        mdFiles.map(async (file): Promise<DB_Node> => {
          const content = await file.text();
          return {
            id: '0',
            user_id: '',
            name: file.name.slice(0, -3),
            role: 3,
            accessibility: 1,
            access: 2,
            content,
            content_compiled: compile(content),
            created_timestamp: now,
            updated_timestamp: now,
          };
        }),
      );
      const job = ref<ImportJob>({
        status: 'pending',
        toCreate: markdownNodes.length,
        toUpdate: 0,
        created: [],
        updated: [],
        failures: 0,
      });
      await nodesStore.importMultipleNodes({ toCreate: markdownNodes, toUpdate: [] }, job);
      const ok = job.value.created.length;
      notifications.add({
        type: job.value.failures ? 'warning' : 'success',
        title: t('import.notifications.importCompleteTitle'),
        message:
          mdFiles.length > 1
            ? `${ok}/${mdFiles.length} documentos importados correctamente`
            : `"${markdownNodes[0].name}" importado correctamente`,
      });
      selectedFiles.value = [];
      dropComponent.value?.reset();
    } else {
      // Backup file — single-file preview flow
      const result = await handleBackupFile(backupFiles[0]);
      manifest.value = result.manifest;
      localData.value = result.localData;
      if (result.documents?.length) {
        backupDocuments.value = result.documents;
        const { toCreate: create, toUpdate: update } = nodesStore.prepareImport(result.documents);
        toCreate.value = create;
        toUpdate.value = update;
      } else {
        backupDocuments.value = [];
        toCreate.value = [];
        toUpdate.value = [];
      }
      step.value = 'preview';
    }
  } catch (e) {
    analyzeError.value = e instanceof Error ? e.message : 'Failed to analyze backup file';
  } finally {
    isAnalyzing.value = false;
  }
}

function resetImport() {
  step.value = 'select';
  selectedFiles.value = [];
  dropComponent.value?.reset();
  manifest.value = null;
  backupDocuments.value = [];
  toCreate.value = [];
  toUpdate.value = [];

  importJob.value = {
    status: 'pending',
    toCreate: 0,
    toUpdate: 0,
    created: [],
    updated: [],
    failures: 0,
  };
}

async function importNodes(type: 'create' | 'update', ids: string[]) {
  const nodes: DB_Node[] = type === 'create' ? toCreate.value.filter(d => ids.includes(d.id)) : toUpdate.value.filter(d => ids.includes(d.id));

  if (type === 'create') {
    importJob.value.toCreate = nodes.length;
    await nodesStore.importMultipleNodes({ toCreate: nodes, toUpdate: [] }, importJob);
    toCreate.value = toCreate.value.filter(d => !importJob.value.created.includes(d.id));
  } else if (type == 'update') {
    importJob.value.toUpdate = nodes.length;
    await nodesStore.importMultipleNodes({ toCreate: [], toUpdate: nodes }, importJob);
    toUpdate.value = toUpdate.value.filter(d => !importJob.value.updated.includes(d.id));
  }

  notifications.add({
    type: 'success',
    title: 'Import complete',
    message: `${importJob.value.created.length + importJob.value.updated.length} documents ${type === 'create' ? 'imported' : 'updated'}`,
  });
}

function importLocalSettings() {
  if (!manifest.value) return;

  const preferences = usePreferencesStore();
  if (localData.value) {
    preferences.importPreferences(localData.value);
    notifications.add({
      type: 'success',
      title: t('import.notifications.localImportedTitle'),
      message: t('import.notifications.localImportedMessage'),
    });
  } else {
    notifications.add({
      type: 'error',
      title: t('import.notifications.importFailedTitle'),
      message: t('import.notifications.importFailedMessage'),
    });
  }
}

async function importAll() {
  const createDocs = toCreate.value;
  const updateDocs = importOptions.skipExisting ? [] : toUpdate.value;

  importJob.value.toCreate = createDocs.length;
  importJob.value.toUpdate = updateDocs.length;

  await nodesStore.importMultipleNodes({ toCreate: createDocs, toUpdate: updateDocs }, importJob);
  toCreate.value = toCreate.value.filter(d => !importJob.value.created.includes(d.id));
  toUpdate.value = toUpdate.value.filter(d => !importJob.value.updated.includes(d.id));

  notifications.add({
    type: 'success',
    title: t('import.notifications.importCompleteTitle'),
    message: t('import.notifications.importCompleteMessage'),
  });
}
</script>

<style scoped lang="scss">
.import-page {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.submit {
  display: flex;
  justify-content: center;
  margin-top: 1rem;
}

.error-text {
  font-size: 0.9rem;
  color: var(--red);
  text-align: center;
  margin-top: 0.5rem;
}
</style>
