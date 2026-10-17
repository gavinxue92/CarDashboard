<script setup lang="ts">
/**
 * L1 左侧导航（交互说明 第 4 / 6 节）。
 *
 * V1.1 布局调整后，运行状态圆点、账号备注、⋯ 操作菜单三样东西都从原来的
 * 内容区顶栏搬到了这里——参照产品的思路是「壳越薄越好」，不额外压缩官方页面空间。
 *
 * ⚠️ ⋯ 菜单必须定位在**侧栏宽度之内**：内嵌视图是原生层，永远盖在我方 HTML 之上，
 * 菜单一旦溢到内容区就会被官方页面挡住。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import {
  COMING_SOON_TEXT,
  DOMAINS,
  WA_STATUS_TOOLTIP,
  WHATSAPP_FEATURE_ID,
  type DomainItem,
} from '@cd/shared';
import { openDialog, reloadWa, selectFeature, toast, workspace } from '../stores/workspace';

const { state } = workspace;

const menuOpen = ref(false);
const menuTop = ref(0);

const memoText = computed(() => state.memo || '点击设置备注');

function isDomainLocked(domain: DomainItem): boolean {
  return domain.features.every((f) => !f.enabled);
}

function dotClass(featureId: string): string {
  if (featureId !== WHATSAPP_FEATURE_ID) return 'feature__dot--idle';
  return `feature__dot--${state.waStatus}`;
}

function onFeatureClick(featureId: string, enabled: boolean): void {
  if (!enabled) {
    toast({ message: COMING_SOON_TEXT, type: 'warning' });
    return;
  }
  selectFeature(featureId);
}

function toggleMenu(event: MouseEvent): void {
  event.stopPropagation();
  if (menuOpen.value) {
    menuOpen.value = false;
    return;
  }
  const target = event.currentTarget as HTMLElement | null;
  menuTop.value = Math.round((target?.getBoundingClientRect().bottom ?? 0) + 4);
  menuOpen.value = true;
}

function closeMenu(): void {
  menuOpen.value = false;
}

function onReload(): void {
  closeMenu();
  void reloadWa();
}

function onSetMemo(): void {
  closeMenu();
  openDialog('memo');
}

function onUnbind(): void {
  closeMenu();
  openDialog('unbind');
}

onMounted(() => {
  document.addEventListener('click', closeMenu);
});

onBeforeUnmount(() => {
  document.removeEventListener('click', closeMenu);
});
</script>

<template>
  <aside class="app-sidebar">
    <div v-for="domain in DOMAINS" :key="domain.id" class="domain">
      <div class="domain__title">
        <span>{{ domain.name }}</span>
        <span v-if="isDomainLocked(domain)" class="domain__lock">{{ COMING_SOON_TEXT }}</span>
      </div>

      <template v-for="feature in domain.features" :key="feature.id">
        <div
          class="feature"
          :class="{
            'feature--active': feature.enabled && state.activeFeatureId === feature.id,
            'feature--disabled': !feature.enabled,
          }"
          :title="feature.enabled ? undefined : COMING_SOON_TEXT"
          @click="onFeatureClick(feature.id, feature.enabled)"
        >
          <i
            class="feature__dot"
            :class="dotClass(feature.id)"
            :title="feature.id === WHATSAPP_FEATURE_ID ? WA_STATUS_TOOLTIP : undefined"
          />
          <span class="feature__label">{{ feature.name }}</span>
          <span v-if="feature.id === WHATSAPP_FEATURE_ID" class="feature__actions">
            <button class="feature__more" title="更多操作" @click="toggleMenu">⋯</button>
          </span>
        </div>

        <!-- 账号备注（FR-3.7 替代方案）：位置对齐参考产品的左侧账号栏 -->
        <div
          v-if="feature.id === WHATSAPP_FEATURE_ID"
          class="feature__memo"
          :class="{ 'feature__memo--empty': !state.memo }"
          title="设置账号备注"
          @click="openDialog('memo')"
        >
          {{ memoText }}
        </div>
      </template>
    </div>

    <div v-if="menuOpen" class="feature-menu" :style="{ left: '8px', top: `${menuTop}px` }">
      <button class="feature-menu__item" @click="onReload">重新加载</button>
      <button class="feature-menu__item" @click="onSetMemo">设置账号备注</button>
      <button class="feature-menu__item feature-menu__item--danger" @click="onUnbind">
        解除绑定
      </button>
    </div>
  </aside>
</template>
