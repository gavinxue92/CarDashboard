<script setup lang="ts">
import { onMounted } from 'vue';
import AppTitleBar from './layout/AppTitleBar.vue';
import AppSidebar from './layout/AppSidebar.vue';
import AppContent from './layout/AppContent.vue';
import UnbindDialog from './components/UnbindDialog.vue';
import MemoDialog from './components/MemoDialog.vue';
import TranslateSettingsDialog from './components/TranslateSettingsDialog.vue';
import { initWorkspace, workspace } from './stores/workspace';

const { state } = workspace;

onMounted(() => {
  void initWorkspace();
});
</script>

<template>
  <div class="app-shell">
    <AppTitleBar />

    <div class="app-body">
      <AppSidebar />
      <AppContent />
    </div>

    <UnbindDialog v-if="state.dialog === 'unbind'" />
    <MemoDialog v-else-if="state.dialog === 'memo'" />
    <TranslateSettingsDialog v-else-if="state.dialog === 'translate'" />
  </div>
</template>
