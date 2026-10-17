<script setup lang="ts">
/**
 * 内容区容器（L1）。
 *
 * 这是整个工程里唯一与原生视图「对坐标」的地方：
 * 渲染层负责测量内容区矩形并把结果同步给主进程，主进程据此摆布内嵌视图。
 *
 * 为什么由渲染层测量而不是主进程自己算：左侧导航宽度、右侧功能栏显隐、
 * 标题栏高度都是我方布局的自由变量，主进程重算一份等于把布局规则写两遍，必然漂移。
 * 单向数据流——布局只由渲染层决定，主进程只负责摆。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { WHATSAPP_FEATURE_ID } from '@cd/shared';
import FeatureRail from '../components/FeatureRail.vue';
import WhatsAppView from '../views/WhatsAppView.vue';
import PlaceholderView from '../views/PlaceholderView.vue';
import { setContentWidth, workspace } from '../stores/workspace';

const { state, embedOccluded } = workspace;

const contentEl = ref<HTMLElement | null>(null);
const isWhatsApp = computed(() => state.activeFeatureId === WHATSAPP_FEATURE_ID);

const bridge = window.cd;
let observer: ResizeObserver | null = null;

function syncView(): void {
  const el = contentEl.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  setContentWidth(rect.width);
  bridge.wa.syncView({
    bounds: {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    },
    occluded: embedOccluded.value,
  });
}

onMounted(() => {
  const el = contentEl.value;
  if (!el) return;
  observer = new ResizeObserver(() => syncView());
  observer.observe(el);
  window.addEventListener('resize', syncView);
  void nextTick(syncView);
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
  window.removeEventListener('resize', syncView);
});

// 遮挡状态变化（开弹窗、窗口过窄、切走模块）必须立刻同步，否则内嵌视图会盖住弹窗
watch(embedOccluded, () => syncView());
watch(
  () => state.activeFeatureId,
  () => void nextTick(syncView),
);
</script>

<template>
  <section class="app-content">
    <div ref="contentEl" class="content-main">
      <WhatsAppView v-if="isWhatsApp" />
      <PlaceholderView v-else />
    </div>

    <!-- 右侧功能栏（FR-3.19）：内嵌区存在时显示；M4 故障态下隐藏以免误操作（交互说明 5.5） -->
    <FeatureRail v-if="isWhatsApp && state.waStatus !== 'error'" />
  </section>
</template>
