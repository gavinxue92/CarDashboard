<script setup lang="ts">
/**
 * M4 故障覆盖层（交互说明 5.3）。
 *
 * 两种场景按 Chromium 错误码区分：
 *   网络类错误（断网、DNS、超时、代理失败）→ 「网络连接异常」
 *   其余（页面本身出问题）              → 「页面加载失败」
 *
 * 注意：这一层能被用户看到，靠的是主进程把原生内嵌视图隐藏了——
 * 原生视图级别高于我方 HTML，用 z-index 是盖不住它的。
 */
import { computed } from 'vue';
import { reloadWa, workspace } from '../stores/workspace';

const props = defineProps<{ offsetTop: number }>();

const { isNetworkIssue } = workspace;

const title = computed(() => (isNetworkIssue.value ? '网络连接异常' : '页面加载失败'));

const description = computed(() =>
  isNetworkIssue.value
    ? '当前网络无法访问 WhatsApp 服务，请联系管理员确认办公网络是否可访问境外。'
    : '无法打开 WhatsApp 页面，请检查网络后重试。',
);
</script>

<template>
  <div class="fault-overlay" :style="{ top: `${props.offsetTop}px` }">
    <div class="fault-card">
      <div class="fault-card__icon">!</div>
      <div class="fault-card__title">{{ title }}</div>
      <p class="fault-card__desc">{{ description }}</p>
      <div class="fault-card__actions">
        <button class="btn btn--primary" @click="reloadWa">重新加载</button>
      </div>
    </div>
  </div>
</template>
