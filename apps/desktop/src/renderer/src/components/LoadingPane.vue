<script setup lang="ts">
/**
 * M1 加载中（交互说明 5.1）。
 * 10 秒未完成则文案变为「仍在加载，网络可能较慢…」并露出重试按钮（FR-3.8 / 决策 D2）。
 */
import { computed } from 'vue';
import { reloadWa, workspace } from '../stores/workspace';

const { state } = workspace;
const timedOut = computed(() => state.waLoadTimedOut);
</script>

<template>
  <div class="loading-pane">
    <div class="spinner" />
    <p class="loading-pane__text">
      {{ timedOut ? '仍在加载，网络可能较慢…' : '正在打开 WhatsApp…' }}
    </p>
    <button v-if="timedOut" class="btn" @click="reloadWa">重试</button>
    <p class="loading-pane__hint">
      首次打开需要从境外加载页面资源，可能偏慢。若长时间无响应，通常是办公网络无法访问境外服务。
    </p>
  </div>
</template>
