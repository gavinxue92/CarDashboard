<script setup lang="ts">
/**
 * 右侧功能栏（FR-3.19，交互说明 5.5）。
 *
 * 紧贴内容区右缘、竖排一列，占的是**我方布局预留的空间**，不覆盖官方页面。
 *
 * V1.4 起它多了一个职责：**当翻译没开或渠道不可用时给出可见提示**。
 * 因为翻译默认是关的（避免未经确认就把客户消息送到第三方翻译服务），
 * 如果没有任何提示，使用者会以为「功能没做出来」。
 */
import { COMING_SOON_TEXT } from '@cd/shared';
import { openDialog, toast, workspace } from '../stores/workspace';

const { state, translateNeedsAttention, translateAttentionText } = workspace;

function onReserved(name: string): void {
  toast({ message: `${name} · ${COMING_SOON_TEXT}`, type: 'warning' });
}

/** 正常态下的悬停提示：显示当前实际生效的渠道，便于排障 */
function translateTitle(): string {
  if (translateAttentionText.value) return translateAttentionText.value;
  const provider = state.translateProviderLabel || '内置免费通道';
  return `翻译设置 · 当前渠道：${provider}`;
}
</script>

<template>
  <aside class="feature-rail">
    <button
      class="rail-btn"
      :class="{ 'rail-btn--attention': translateNeedsAttention }"
      :title="translateTitle()"
      @click="openDialog('translate')"
    >
      <span class="rail-btn__icon">译</span>
      <span class="rail-btn__label">翻译设置</span>
      <span v-if="translateNeedsAttention" class="rail-btn__dot" />
    </button>

    <button
      class="rail-btn rail-btn--disabled"
      :title="COMING_SOON_TEXT"
      @click="onReserved('客户信息')"
    >
      <span class="rail-btn__icon">客</span>
      <span class="rail-btn__label">客户信息</span>
    </button>

    <button
      class="rail-btn rail-btn--disabled"
      :title="COMING_SOON_TEXT"
      @click="onReserved('快捷消息')"
    >
      <span class="rail-btn__icon">快</span>
      <span class="rail-btn__label">快捷消息</span>
    </button>
  </aside>
</template>
