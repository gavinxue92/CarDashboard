<script setup lang="ts">
/**
 * O3 断线浮条（交互说明 6.3）。
 *
 * 非模态、不打断操作。我方按 5s / 15s / 30s 退避重连（实现在主进程），
 * 三次都失败后文案改为「持续无法连接」并露出「立即重试」。
 */
import { computed } from 'vue';
import { reloadWa, workspace } from '../stores/workspace';

const { state } = workspace;

const exhausted = computed(() => state.waRetryExhausted);
const text = computed(() => (exhausted.value ? '持续无法连接' : '连接异常，正在尝试自动重连…'));
</script>

<template>
  <div class="disconnect-bar">
    <span class="disconnect-bar__dot" />
    <span class="disconnect-bar__text">{{ text }}</span>
    <button v-if="exhausted" class="disconnect-bar__action" @click="reloadWa">立即重试</button>
    <span v-else class="disconnect-bar__count">第 {{ state.waRetryCount }} 次重连</span>
  </div>
</template>
