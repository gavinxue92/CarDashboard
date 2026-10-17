<script setup lang="ts">
/**
 * 窄窗口引导（IX-1.6）。
 * 官方页面在窗口过窄时自己也会提示，但那提示出现得太晚、且措辞含糊；
 * 我方在内容区宽度不足 MIN_CONTENT_WIDTH 时提前拦截，避免用户对着半截界面猜。
 */
</script>

<template>
  <div class="narrow-hint">
    <div class="narrow-hint__title">窗口过窄</div>
    <p class="narrow-hint__desc">
      请放大窗口以获得完整的 WhatsApp 体验。官方页面需要约 900px 以上宽度，才能同时显示会话列表与消息区域。
    </p>
  </div>
</template>
