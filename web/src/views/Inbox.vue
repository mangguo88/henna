<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { api, type MailDetail, type MailItem } from '../api';
import { fmtSize, fmtTime, toast } from '../store';
import { useRouter } from 'vue-router';

const router = useRouter();

const box = ref<'in' | 'out' | 'draft'>('in');
const starOnly = ref(false);
const items = ref<MailItem[]>([]);
const detail = ref<MailDetail | null>(null);
const q = ref('');
const loading = ref(false);

async function load() {
  loading.value = true;
  try {
    const qs = new URLSearchParams({ box: box.value, q: q.value, scope: 'all' });
    // 收件箱对管理员聚合全站：scope=all 仅管理员生效（后端已校验），
    // 普通用户传了也只返回自己的，不会越权。管理员点收件箱即可看到
    // 所有创建的邮箱收到的信，不必再去翻每个邮箱。
    if (starOnly.value) qs.set('star', '1');
    items.value = await api.get<MailItem[]>(`/message?${qs}`);
  } catch (e) {
    toast((e as Error).message, 'err');
  } finally {
    loading.value = false;
  }
}

async function open(id: number) {
  if (box.value === 'draft') {
    const d = await api.get<MailDetail>(`/message/${id}`);
    router.push({
      path: '/compose',
      query: { draft: String(id), to: d.to_addr, subject: d.subject ?? '', body: d.html_body ?? d.text_body ?? '' },
    });
    return;
  }
  try {
    detail.value = await api.get<MailDetail>(`/message/${id}`);
    const it = items.value.find((i) => i.id === id);
    if (it) it.is_read = 1;
  } catch (e) {
    toast((e as Error).message, 'err');
  }
}

async function remove(id: number) {
  if (!confirm('确认删除该邮件？')) return;
  await api.del(`/message/${id}`);
  detail.value = null;
  toast('已删除');
  await load();
}

async function star() {
  if (!detail.value) return;
  const next = detail.value.is_star ? 0 : 1;
  await api.post(`/message/${detail.value.id}/star`, { star: next });
  detail.value.is_star = next;
}
/** 引用原文：优先纯文本，只有 HTML 时剥掉标签再引 */
function quoteText() {
  const d = detail.value;
  if (!d) return '';
  if (d.text_body) return d.text_body;
  if (d.html_body) return d.html_body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return '';
}

/** 回复：收件人是原发件人，主题加 Re:，正文带上原文引用 */
function reply() {
  if (!detail.value) return;
  const d = detail.value;
  const subject = d.subject?.startsWith('Re:') ? d.subject : `Re: ${d.subject || ''}`;
  const body = `\n\n--- 原始邮件 ---\n发件人：${d.from_name || d.from_addr} <${d.from_addr}>\n时间：${new Date(d.created_at).toLocaleString()}\n收件人：${d.to_addr}\n主题：${d.subject || ''}\n\n${quoteText()}`;
  router.push({ path: '/compose', query: { to: d.from_addr, subject, body } });
}

/** 转发：收件人留空自己填，主题加 Fwd:，正文带上原文引用 */
function forward() {
  if (!detail.value) return;
  const d = detail.value;
  const subject = d.subject?.startsWith('Fwd:') ? d.subject : `Fwd: ${d.subject || ''}`;
  const body = `\n\n--- 转发的邮件 ---\n发件人：${d.from_name || d.from_addr} <${d.from_addr}>\n时间：${new Date(d.created_at).toLocaleString()}\n收件人：${d.to_addr}\n主题：${d.subject || ''}\n\n${quoteText()}`;
  router.push({ path: '/compose', query: { subject, body } });
}


const safeHtml = computed(() => detail.value?.html_body ?? '');

const emptyText = computed(() => {
  if (starOnly.value) return '还没有星标邮件';
  if (box.value === 'draft') return '没有任何草稿';
  if (box.value === 'out') return '还没有发送记录';
  return '暂无邮件。开启 Cloudflare Email Routing 后即可收信。';
});

/**
 * 列表栏宽：默认 280px（比原来的 320px 再窄一点），拖右侧分界线可改，
 * 240~520px 之间，记在本地。手机端不生效，列表仍占满屏。
 */
const LIST_WIDTH_KEY = 'henna.list.width';
const clampListPx = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
function readListWidth() {
  const v = Number(localStorage.getItem(LIST_WIDTH_KEY));
  return Number.isFinite(v) && v > 0 ? clampListPx(v, 240, 520) : 280;
}
const listWidth = ref(readListWidth());
const isDesktop = ref(false);
let listMq: MediaQueryList | null = null;
function onListMqChange(e: MediaQueryListEvent) {
  isDesktop.value = e.matches;
}
function startListDrag(e: PointerEvent) {
  const startX = e.clientX;
  const startW = listWidth.value;
  const move = (ev: PointerEvent) => {
    listWidth.value = clampListPx(startW + (ev.clientX - startX), 240, 520);
  };
  const up = () => {
    localStorage.setItem(LIST_WIDTH_KEY, String(listWidth.value));
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}
const listStyle = computed(() => (isDesktop.value ? { width: `${listWidth.value}px` } : {}));

onMounted(() => {
  listMq = window.matchMedia('(min-width: 768px)');
  isDesktop.value = listMq.matches;
  listMq.addEventListener('change', onListMqChange);
});
onUnmounted(() => listMq?.removeEventListener('change', onListMqChange));

watch([box, starOnly], load);
onMounted(load);
</script>

<template>
  <div class="flex h-full">
    <!-- 列表 -->
    <section class="flex w-full flex-col md:shrink-0 md:border-r md:border-sand-200" :style="listStyle">
      <!-- 表头分两行：第一行页签+星标，第二行搜索框独占一行；
           原来三样挤在一行时列表里搜索框会被压窄、占位文字溢出到框外 -->
      <div class="border-b border-sand-200 bg-white px-4 py-3">
        <div class="flex items-center gap-2">
        <div class="flex gap-1 rounded-lg bg-sand-100 p-1">
          <button
            class="rounded-md px-3 py-1 text-xs font-medium"
            :class="box === 'in' ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500'"
            @click="box = 'in'"
          >
            收件箱
          </button>
          <button
            class="rounded-md px-3 py-1 text-xs font-medium"
            :class="box === 'out' ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500'"
            @click="box = 'out'"
          >
            已发送
          </button>
          <button
            class="rounded-md px-3 py-1 text-xs font-medium"
            :class="box === 'draft' ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500'"
            @click="box = 'draft'"
          >
            草稿箱
          </button>
        </div>
        <button
          class="shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium transition"
          :class="starOnly ? 'border-clay-400 bg-clay-500/10 text-clay-600' : 'border-sand-200 text-ink-500'"
          @click="starOnly = !starOnly"
        >
          ★ 星标
        </button>
        </div>
        <input v-model="q" class="input mt-2 w-full !py-1.5 text-xs" placeholder="搜索主题 / 地址" @keyup.enter="load" />
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto">
        <div v-if="!items.length && !loading" class="p-8 text-center">
          <svg viewBox="0 0 24 24" class="mx-auto h-12 w-12 text-sand-300" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M3 7h18v10H3z" /><path d="M3 7l9 6 9-6" />
          </svg>
          <p class="mt-3 text-sm text-ink-500">{{ emptyText }}</p>
        </div>
        <button
          v-for="m in items"
          :key="m.id"
          class="block w-full border-b border-sand-100 px-4 py-3 text-left transition hover:bg-sand-100"
          :class="detail?.id === m.id ? 'bg-henna-50' : ''"
          @click="open(m.id)"
        >
          <div class="flex items-baseline justify-between gap-2">
            <span class="truncate text-sm" :class="m.is_read ? 'font-normal text-ink-700' : 'font-semibold text-ink-900'">
              {{ box === 'in' ? m.from_name || m.from_addr : m.to_addr }}
            </span>
            <span class="shrink-0 text-[11px] text-ink-500">{{ fmtTime(m.created_at) }}</span>
          </div>
          <div class="mt-0.5 truncate text-sm text-ink-700">{{ m.subject || '(无主题)' }}</div>
          <div class="mt-0.5 truncate text-xs text-ink-500">{{ m.snippet ? m.snippet : '(无正文)' }}</div>
          <div class="mt-1 flex items-center gap-2 text-[11px] text-ink-500">
            <span v-if="box === 'in'">收件 {{ m.to_addr }}</span>
            <span>{{ fmtSize(m.size) }}</span>
            <span v-if="m.is_star" class="text-clay-500">★ 星标</span>
            <span v-if="!m.is_read" class="chip-warn">未读</span>
          </div>
        </button>
      </div>
    </section>

    <!-- 详情 -->
    <!-- 列表与详情之间的可拖分界线：拖动改列表宽度（仅桌面端） -->
    <div
      v-if="isDesktop"
      class="hidden w-[5px] shrink-0 cursor-col-resize touch-none bg-sand-200 transition-colors hover:bg-henna-400 active:bg-henna-500 md:block"
      title="拖动调整列表宽度"
      @pointerdown="startListDrag"
    ></div>
    <section class="hidden min-w-0 flex-1 flex-col md:flex">
      <div v-if="!detail" class="grid flex-1 place-items-center text-sm text-ink-500">
        选择一封邮件查看内容
      </div>
      <template v-else>
        <div class="flex items-start justify-between gap-4 border-b border-sand-200 bg-white px-6 py-4">
          <div class="min-w-0">
            <h2 class="truncate text-base font-semibold text-ink-900">{{ detail.subject || '(无主题)' }}</h2>
            <p class="mt-1 text-xs text-ink-500">
              发件人 {{ detail.from_name || detail.from_addr }} &lt;{{ detail.from_addr }}&gt; · 收件人 {{ detail.to_addr }}
            </p>
          </div>
          <div class="flex shrink-0 gap-2">
            <button class="btn-primary !px-2.5 !py-1.5 text-xs" @click="reply">回复</button>
            <button class="btn-ghost !px-2.5 !py-1.5 text-xs" @click="forward">转发</button>
            <button class="btn-ghost !px-2.5 !py-1.5 text-xs" @click="star">
              {{ detail.is_star ? '取消星标' : '星标' }}
            </button>
            <button class="btn-danger !px-2.5 !py-1.5 text-xs" @click="remove(detail.id)">删除</button>
          </div>
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto p-6">
          <div
            v-if="detail.html_body"
            class="prose prose-sm max-w-none rounded-card border border-sand-200 bg-white p-5"
            v-html="safeHtml"
          ></div>
          <pre v-else class="whitespace-pre-wrap rounded-card border border-sand-200 bg-white p-5 font-sans text-sm">{{ detail.text_body }}</pre>

          <div v-if="detail.attachments?.length" class="mt-4 card p-4">
            <div class="mb-2 text-xs font-semibold text-ink-500">附件 {{ detail.attachments.length }}</div>
            <a
              v-for="a in detail.attachments"
              :key="a.id"
              :href="`/api/message/attachment/${a.id}`"
              target="_blank"
              class="mr-2 inline-block rounded-lg border border-sand-200 px-3 py-1.5 text-xs text-henna-600 hover:bg-henna-50"
            >
              {{ a.name }} · {{ fmtSize(a.size) }}
            </a>
          </div>
        </div>
      </template>
    </section>
  </div>
</template>
