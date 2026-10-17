<script setup lang="ts">
/**
 * O4 翻译设置弹窗（交互说明 7.4，FR-3.20 / 3.21 / 3.29）。
 *
 * 🔴 V1.4 修订（决策 D6 → D7）：
 * 本弹窗已从「接口预留壳」升格为**真实生效的配置界面** ——
 * 保存后主进程会把配置推给注入脚本，翻译行为立即改变，无需重启（FR-3.29）。
 *
 * 字段与结构仍然**冻结**：后续换翻译渠道时只替换实现，不许改这里的结构（IX-8.6）。
 *
 * ⚠️ 本版不生效的项：`channel`（渠道由密钥可用性决定）、`group`、`order`、
 *    `groupShow`、`groupAuto`、`personalHistory`、`groupHistory`、
 *    `recommendReply`、`messageNotify`、`recommendCount`。
 *    它们保留在界面上是为了让契约与版式稳定，不是占位遗漏。
 *
 * 三栏版式与参考产品一致：基础设置 / 渠道与语言 → 常用配置 → 显示样式 / 智能与通知。
 */
import { computed, onMounted, ref } from 'vue';
import {
  ACCOUNT_GROUP_OPTIONS,
  LANGUAGE_OPTIONS,
  STEP_RANGES,
  TRANSLATE_CHANNEL_OPTIONS,
  TRANSLATE_TEXT_BG_OPTIONS,
  TRANSLATE_TEXT_COLOR_OPTIONS,
  normalizeTranslateSettings,
  type WATranslateSettings,
} from '@cd/shared';
import {
  closeDialog,
  fetchTranslateSettings,
  saveTranslateSettings,
  workspace,
} from '../stores/workspace';

const { state } = workspace;

const cfg = ref<WATranslateSettings>(normalizeTranslateSettings(undefined));
const ready = ref(false);

/** IX-8.5：弹窗顶部展示账号备注，未设置时显示「未命名账号」 */
const accountLabel = computed(() => state.memo || '未命名账号');

/** 当前**实际生效**的渠道（由主进程按密钥可用性决定，与上面的下拉无关） */
const effectiveProvider = computed(() => state.translateProviderLabel || '内置免费通道');

const bgSwatch = computed(
  () =>
    TRANSLATE_TEXT_BG_OPTIONS.find((o) => o.value === cfg.value.textBgColor)?.swatch ?? '#d9fdd3',
);
const fgSwatch = computed(
  () =>
    TRANSLATE_TEXT_COLOR_OPTIONS.find((o) => o.value === cfg.value.textColor)?.swatch ?? '#111b21',
);

onMounted(async () => {
  cfg.value = await fetchTranslateSettings();
  ready.value = true;
});

function step(key: 'order' | 'fontSize' | 'recommendCount', delta: number): void {
  const range = STEP_RANGES[key];
  const current = cfg.value[key];
  cfg.value[key] = Math.min(range.max, Math.max(range.min, current + delta));
}

function toggle(key: 'enabled' | 'personalShow' | 'recommendReply' | 'messageNotify'): void {
  cfg.value[key] = !cfg.value[key];
}

function save(): void {
  void saveTranslateSettings(cfg.value);
}
</script>

<template>
  <div class="modal-mask">
    <div class="modal modal--lg" role="dialog" aria-modal="true" aria-labelledby="tr-title">
      <div class="modal__header">
        <span id="tr-title" class="modal__title">WhatsApp - 编辑账号</span>
        <span class="modal__badge">{{ accountLabel }}</span>
        <button class="modal__close" title="关闭" @click="closeDialog">✕</button>
      </div>

      <div class="modal__body">
        <div class="tr-layout">
          <!-- ── 第一栏 ───────────────────────────────────────── -->
          <div class="tr-col">
            <section class="tr-group">
              <div class="tr-group__title">基础设置</div>

              <div class="tr-row">
                <span class="tr-row__label">账号备注</span>
                <div class="tr-row__control">
                  <input
                    v-model="cfg.remark"
                    class="text-input tr-input"
                    type="text"
                    maxlength="60"
                  />
                </div>
              </div>

              <div class="tr-row">
                <span class="tr-row__label">是否启用</span>
                <div class="tr-row__control">
                  <button
                    class="switch"
                    :class="{ 'switch--on': cfg.enabled }"
                    role="switch"
                    :aria-checked="cfg.enabled"
                    @click="toggle('enabled')"
                  />
                </div>
              </div>

              <p class="tr-note">
                默认关闭。开启后：对方发来的消息自动译成中文、显示在原文下方；你输入的中文在发送时译成英文。
                按 <b>Alt+回车</b> 可直接发送原文不翻译。翻译失败时消息不会发出并会提示，以免把中文原文发出去。
                消息原文会发送至第三方翻译服务。
              </p>

              <div class="tr-row">
                <span class="tr-row__label">账号分组</span>
                <div class="tr-row__control">
                  <select v-model="cfg.group" class="select">
                    <option value="">请选择</option>
                    <option v-for="g in ACCOUNT_GROUP_OPTIONS" :key="g" :value="g">{{ g }}</option>
                  </select>
                </div>
              </div>

              <div class="tr-row">
                <span class="tr-row__label">顺序</span>
                <div class="tr-row__control">
                  <div class="stepper">
                    <button
                      class="stepper__btn"
                      :disabled="cfg.order <= STEP_RANGES.order.min"
                      @click="step('order', -1)"
                    >
                      −
                    </button>
                    <span class="stepper__value">{{ cfg.order }}</span>
                    <button
                      class="stepper__btn"
                      :disabled="cfg.order >= STEP_RANGES.order.max"
                      @click="step('order', 1)"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>
            </section>

            <section class="tr-group">
              <div class="tr-group__title">渠道与语言</div>

              <div class="tr-row">
                <span class="tr-row__label">翻译渠道</span>
                <div class="tr-row__control">
                  <select v-model="cfg.channel" class="select">
                    <option v-for="c in TRANSLATE_CHANNEL_OPTIONS" :key="c" :value="c">
                      {{ c }}
                    </option>
                  </select>
                </div>
              </div>

              <p class="tr-note">
                渠道选择本版暂不生效，当前实际使用：<b>{{ effectiveProvider }}</b
                >。未配置密钥时走内置免费通道，配置 DeepL 密钥后自动切换。
              </p>

              <div class="tr-row">
                <span class="tr-row__label">对方语言</span>
                <div class="tr-row__control">
                  <select v-model="cfg.peerLanguage" class="select">
                    <option v-for="l in LANGUAGE_OPTIONS" :key="l" :value="l">{{ l }}</option>
                  </select>
                </div>
              </div>

              <div class="tr-row">
                <span class="tr-row__label">我的语言</span>
                <div class="tr-row__control">
                  <select v-model="cfg.myLanguage" class="select">
                    <option v-for="l in LANGUAGE_OPTIONS" :key="l" :value="l">{{ l }}</option>
                  </select>
                </div>
              </div>
            </section>
          </div>

          <!-- ── 第二栏 ───────────────────────────────────────── -->
          <div class="tr-col">
            <section class="tr-group">
              <div class="tr-group__title">常用配置</div>

              <div class="tr-row">
                <span class="tr-row__label">接收自动翻译</span>
                <div class="tr-row__control">
                  <button
                    class="switch"
                    :class="{ 'switch--on': cfg.autoReceive }"
                    role="switch"
                    :aria-checked="cfg.autoReceive"
                    @click="cfg.autoReceive = !cfg.autoReceive"
                  />
                </div>
              </div>

              <div class="tr-row">
                <span class="tr-row__label">发送自动翻译</span>
                <div class="tr-row__control">
                  <button
                    class="switch"
                    :class="{ 'switch--on': cfg.autoSend }"
                    role="switch"
                    :aria-checked="cfg.autoSend"
                    @click="cfg.autoSend = !cfg.autoSend"
                  />
                </div>
              </div>

              <div class="tr-row">
                <span class="tr-row__label">群聊翻译显示</span>
                <div class="tr-row__control">
                  <button
                    class="switch"
                    :class="{ 'switch--on': cfg.groupShow }"
                    role="switch"
                    :aria-checked="cfg.groupShow"
                    @click="cfg.groupShow = !cfg.groupShow"
                  />
                </div>
              </div>

              <div class="tr-row">
                <span class="tr-row__label">群聊自动翻译</span>
                <div class="tr-row__control">
                  <button
                    class="switch"
                    :class="{ 'switch--on': cfg.groupAuto }"
                    role="switch"
                    :aria-checked="cfg.groupAuto"
                    @click="cfg.groupAuto = !cfg.groupAuto"
                  />
                </div>
              </div>

              <div class="tr-row">
                <span class="tr-row__label">个人历史翻译</span>
                <div class="tr-row__control">
                  <button
                    class="switch"
                    :class="{ 'switch--on': cfg.personalHistory }"
                    role="switch"
                    :aria-checked="cfg.personalHistory"
                    @click="cfg.personalHistory = !cfg.personalHistory"
                  />
                </div>
              </div>

              <div class="tr-row">
                <span class="tr-row__label">群组历史翻译</span>
                <div class="tr-row__control">
                  <button
                    class="switch"
                    :class="{ 'switch--on': cfg.groupHistory }"
                    role="switch"
                    :aria-checked="cfg.groupHistory"
                    @click="cfg.groupHistory = !cfg.groupHistory"
                  />
                </div>
              </div>

              <div class="tr-row">
                <span class="tr-row__label">繁体中文</span>
                <div class="tr-row__control">
                  <button
                    class="switch"
                    :class="{ 'switch--on': cfg.traditionalChinese }"
                    role="switch"
                    :aria-checked="cfg.traditionalChinese"
                    @click="cfg.traditionalChinese = !cfg.traditionalChinese"
                  />
                </div>
              </div>

              <div class="tr-row">
                <span class="tr-row__label">发送确认</span>
                <div class="tr-row__control">
                  <button
                    class="switch"
                    :class="{ 'switch--on': cfg.sendConfirm }"
                    role="switch"
                    :aria-checked="cfg.sendConfirm"
                    @click="cfg.sendConfirm = !cfg.sendConfirm"
                  />
                </div>
              </div>
            </section>
          </div>

          <!-- ── 第三栏 ───────────────────────────────────────── -->
          <div class="tr-col">
            <section class="tr-group">
              <div class="tr-group__title">显示样式</div>

              <div class="tr-row">
                <span class="tr-row__label">字体大小</span>
                <div class="tr-row__control">
                  <div class="stepper">
                    <button
                      class="stepper__btn"
                      :disabled="cfg.fontSize <= STEP_RANGES.fontSize.min"
                      @click="step('fontSize', -1)"
                    >
                      −
                    </button>
                    <span class="stepper__value">{{ cfg.fontSize }}</span>
                    <button
                      class="stepper__btn"
                      :disabled="cfg.fontSize >= STEP_RANGES.fontSize.max"
                      @click="step('fontSize', 1)"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>

              <div class="tr-row">
                <span class="tr-row__label">译文背景</span>
                <div class="tr-row__control">
                  <span class="swatch swatch--sm" :style="{ background: bgSwatch }" />
                  <select v-model="cfg.textBgColor" class="select">
                    <option v-for="o in TRANSLATE_TEXT_BG_OPTIONS" :key="o.value" :value="o.value">
                      {{ o.label }}
                    </option>
                  </select>
                </div>
              </div>

              <div class="tr-row">
                <span class="tr-row__label">译文颜色</span>
                <div class="tr-row__control">
                  <span class="swatch swatch--sm" :style="{ background: fgSwatch }" />
                  <select v-model="cfg.textColor" class="select">
                    <option
                      v-for="o in TRANSLATE_TEXT_COLOR_OPTIONS"
                      :key="o.value"
                      :value="o.value"
                    >
                      {{ o.label }}
                    </option>
                  </select>
                </div>
              </div>

              <div class="tr-row">
                <span class="tr-row__label">个人翻译显示</span>
                <div class="tr-row__control">
                  <button
                    class="switch"
                    :class="{ 'switch--on': cfg.personalShow }"
                    role="switch"
                    :aria-checked="cfg.personalShow"
                    @click="toggle('personalShow')"
                  />
                </div>
              </div>

              <p class="tr-note">
                指<b>单聊</b>里是否显示译文（与「群聊显示」同一组开关）。关闭后单聊不再显示译文，
                也不再发起翻译。群聊翻译本版不提供。
              </p>
            </section>

            <section class="tr-group">
              <div class="tr-group__title">智能与通知</div>

              <div class="tr-row">
                <span class="tr-row__label">推荐回复</span>
                <div class="tr-row__control">
                  <button
                    class="switch"
                    :class="{ 'switch--on': cfg.recommendReply }"
                    role="switch"
                    :aria-checked="cfg.recommendReply"
                    @click="toggle('recommendReply')"
                  />
                </div>
              </div>

              <div class="tr-row">
                <span class="tr-row__label">消息通知</span>
                <div class="tr-row__control">
                  <button
                    class="switch"
                    :class="{ 'switch--on': cfg.messageNotify }"
                    role="switch"
                    :aria-checked="cfg.messageNotify"
                    @click="toggle('messageNotify')"
                  />
                </div>
              </div>

              <div class="tr-row">
                <span class="tr-row__label">推荐回复条数</span>
                <div class="tr-row__control">
                  <div class="stepper">
                    <button
                      class="stepper__btn"
                      :disabled="cfg.recommendCount <= STEP_RANGES.recommendCount.min"
                      @click="step('recommendCount', -1)"
                    >
                      −
                    </button>
                    <span class="stepper__value">{{ cfg.recommendCount }}</span>
                    <button
                      class="stepper__btn"
                      :disabled="cfg.recommendCount >= STEP_RANGES.recommendCount.max"
                      @click="step('recommendCount', 1)"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>

      <div class="modal__footer">
        <span class="modal__footer-note">
          保存后<b>即时生效</b>，无需重启客户端。仅处理单聊中新收到的文本消息；译文只存在内存中，不落库。
        </span>
        <button class="btn" @click="closeDialog">取消</button>
        <button class="btn btn--primary" :disabled="!ready" @click="save">保存修改</button>
      </div>
    </div>
  </div>
</template>
