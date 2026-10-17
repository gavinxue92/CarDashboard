<script setup lang="ts">
/**
 * WhatsApp 模块容器（L2，交互说明第 5 节）。
 *
 * 这个组件里**没有聊天界面、没有二维码**——那些全部由内嵌的官方页面自己渲染。
 * 我方只负责三种「页面不正常」时的兜底呈现：
 *   M1 加载中 / M4 故障覆盖层 / 窄窗口引导，外加 O3 断线浮条。
 *
 * 页面正常时这里什么都不显示，把整块区域让给官方页面。
 */
import { computed } from 'vue';
import DisconnectBar from '../components/DisconnectBar.vue';
import FaultOverlay from '../components/FaultOverlay.vue';
import LoadingPane from '../components/LoadingPane.vue';
import NarrowWindowHint from '../components/NarrowWindowHint.vue';
import { workspace } from '../stores/workspace';

const { narrowWindow, showDisconnectBar, showLoading, showFaultOverlay } = workspace;

/** 浮条占位高度，故障覆盖层需要下移让开（交互说明 6.3 + 5.3） */
const BAR_HEIGHT = 38;

const faultOffsetTop = computed(() => (showDisconnectBar.value ? BAR_HEIGHT : 0));
</script>

<template>
  <!-- 窗口过窄时官方页面无法正常使用，优先级最高：直接引导放大窗口（IX-1.6） -->
  <NarrowWindowHint v-if="narrowWindow" />

  <template v-else>
    <DisconnectBar v-if="showDisconnectBar" />
    <LoadingPane v-if="showLoading" />
    <FaultOverlay v-else-if="showFaultOverlay" :offset-top="faultOffsetTop" />
  </template>
</template>
