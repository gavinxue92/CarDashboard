<script setup lang="ts">
/**
 * 账号备注输入框（交互说明 7.3，FR-3.7 的替代方案）。
 *
 * 为什么需要人工填：我方读不到官方页面里的登录账号信息，所以「这是谁的号」
 * 只能靠人写一次。入口在导航 ⋯ 菜单与账号备注行两处。
 *
 * IX-4.1：输入为空时「保存」禁用。
 */
import { computed, onMounted, ref } from 'vue';
import { REMARK_PLACEHOLDER } from '@cd/shared';
import { closeDialog, saveMemo, workspace } from '../stores/workspace';

const { state } = workspace;

const value = ref(state.memo);
const inputRef = ref<HTMLInputElement | null>(null);

const canSave = computed(() => value.value.trim().length > 0);

function submit(): void {
  if (!canSave.value) return;
  void saveMemo(value.value);
}

onMounted(() => {
  inputRef.value?.focus();
});
</script>

<template>
  <div class="modal-mask">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="memo-title">
      <div class="modal__header">
        <span id="memo-title" class="modal__title">设置账号备注</span>
        <button class="modal__close" title="关闭" @click="closeDialog">✕</button>
      </div>

      <div class="modal__body">
        <p class="modal__note" style="margin: 0 0 14px">
          给本机绑定的 WhatsApp 号写个备注，方便区分。系统无法自动读取官方页面中的号码，这一项需要手工填写。
        </p>

        <label class="field-label" for="memo-input">账号备注</label>
        <input
          id="memo-input"
          ref="inputRef"
          v-model="value"
          class="text-input"
          type="text"
          maxlength="60"
          :placeholder="`例如 ${REMARK_PLACEHOLDER} · +86 138****1234`"
          @keyup.enter="submit"
        />
      </div>

      <div class="modal__footer">
        <button class="btn" @click="closeDialog">取消</button>
        <button class="btn btn--primary" :disabled="!canSave" @click="submit">保存</button>
      </div>
    </div>
  </div>
</template>
