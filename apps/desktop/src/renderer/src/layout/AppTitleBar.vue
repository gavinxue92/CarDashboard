<script setup lang="ts">
import { computed } from 'vue';
import { workspace } from '../stores/workspace';

const { state } = workspace;

const versionLabel = computed(() =>
  state.appInfo ? `v${state.appInfo.appVersion} · 单机版` : 'V1 · 单机版',
);
</script>

<template>
  <!--
    L1 工作台框架 · 标题栏（交互说明 4.1）
    高度必须与主进程 titleBarOverlay.height 一致（TITLE_BAR_HEIGHT = 54）。
    右侧 148px 是留给系统窗口控制按钮的可拖拽留白，由 CSS padding 保证。
  -->
  <header class="app-titlebar">
    <span class="app-titlebar__logo">CD</span>
    <span class="app-titlebar__title">海外获客沟通工作台</span>
    <span class="app-titlebar__spacer" />
    <span class="app-titlebar__role">{{ versionLabel }}</span>
  </header>
</template>
