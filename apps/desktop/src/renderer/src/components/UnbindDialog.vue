<script setup lang="ts">
/**
 * O1 解除绑定确认弹窗（交互说明 7.1）。
 *
 * 文案里必须写明「聊天记录不受影响」——销售最大的顾虑就是解绑会不会丢客户对话，
 * 不写清楚他们不敢点。
 *
 * IX-3.2：默认焦点落在「取消」上，避免误触回车直接解绑。
 */
import { onMounted, ref } from 'vue';
import { closeDialog, unbindWa } from '../stores/workspace';

const cancelRef = ref<HTMLButtonElement | null>(null);

onMounted(() => {
  cancelRef.value?.focus();
});
</script>

<template>
  <div class="modal-mask">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="unbind-title">
      <div class="modal__header">
        <span id="unbind-title" class="modal__title">解除 WhatsApp 绑定</span>
        <button class="modal__close" title="关闭" @click="closeDialog">✕</button>
      </div>

      <div class="modal__body modal__body--plain">
        解除后本机将清除登录状态，需要重新用手机扫码才能再次使用。
        <div class="modal__note">聊天记录不受影响，仍保留在手机和官方服务器中。</div>
        <div class="modal__note">
          账号备注会保留在本机，换号后可在左侧「账号备注」处自行修改。
        </div>
      </div>

      <div class="modal__footer">
        <button ref="cancelRef" class="btn" @click="closeDialog">取消</button>
        <button class="btn btn--danger" @click="unbindWa">确认解除</button>
      </div>
    </div>
  </div>
</template>
