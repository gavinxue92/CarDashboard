<script setup lang="ts">
/**
 * 占位页（FR-1.5）。
 *
 * 本版除「沟通 → WhatsApp」外的 11 个功能都没有实现，也不可点击进入。
 * 保留这个页面是为了导航结构完整——将来逐个开放时，把 enabled 打开即可。
 */
import { computed } from 'vue';
import { COMING_SOON_TEXT } from '@cd/shared';
import { workspace } from '../stores/workspace';

const feature = computed(() => workspace.activeFeature.value);
</script>

<template>
  <div class="placeholder">
    <div class="placeholder__icon">◻</div>
    <div class="placeholder__title">{{ feature?.name ?? '功能' }}</div>
    <div class="placeholder__badge">{{ COMING_SOON_TEXT }}</div>
    <p class="placeholder__desc">
      当前版本仅开放「沟通 → WhatsApp」。该功能的接口与页面结构会在后续版本中逐个补齐。
    </p>
  </div>
</template>
