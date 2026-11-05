<script setup lang="ts">
/**
 * 进入邮箱：只看这一个邮箱的信。
 *
 * 左边是这个邮箱的文件夹（收件箱 / 垃圾邮件 / 星标 / 已发送 / 草稿箱），
 * 中间是邮件列表，右边点开看正文 —— 和参考的邮箱产品同一个排法。
 * 列表只按 mailbox 参数过滤，后端会校验归属：普通用户只能进自己的邮箱。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, type MailDetail, type MailItem } from '../api';
import { fmtSize, fmtTime, store, toast } from '../store';

const route = useRoute();
const router = useRouter();

const addr = computed(() => decodeURIComponent(String(route.params.addr ?? '')));

type Folder = 'in' | 'star' | 'out' | 'draft' | 'spam';
const folders: { key: Folder; label: string }[] = [
  { key: 'in', label: '收件箱' },
  { key: 'spam', label: '垃圾邮件' },
  { key: 'star', label: '星标邮件' },
  { key: 'out', label: '已发送' },
  { key: 'draft', label: '草稿箱' },
];
const folder = ref<Folder>('in');
const folderLabel = computed(() => folders.find((f) => f.key === folder.value)?.label ?? '收件箱');

const items = ref<MailItem[]>([]);
const detail = ref<MailDetail | null>(null);
const q = ref('');
const loading = ref(false);

async function load() {
  loading.value = true;
  try {
    const qs = new URLSearchParams({
      box: folder.value === 'star' ? 'in' : folder.value,
      q: q.value,
      mailbox: addr.value,
    });
    // 管理员进别人的邮箱也要能看到：scope=all 只对管理员生效
    if (store.me?.role === 'admin') qs.set('scope', 'all');
    if (folder.value === 'star') qs.set('star', '1');
    items.value = await api.get<MailItem[]>(`/message?${qs}`);
  } catch (e) {
    toast((e as Error).message, 'err');
  } finally {
    loading.value = false;
  }
}

async function open(id: number) {
  if (folder.value === 'draft') {
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
  if (folder.value === 'star' && !next) await load();
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


async function toggleSpam() {
  if (!detail.value) return;
  const next = detail.value.is_spam ? 0 : 1;
  await api.post(`/message/${detail.value.id}/spam`, { spam: next });
  detail.value.is_spam = next;
  toast(next ? '已标记为垃圾邮件' : '已移出垃圾邮件');
  if (folder.value === 'spam' || folder.value === 'in') await load();
}

const safeHtml = computed(() => detail.value?.html_body ?? '');

const emptyText = computed(() => {
  if (folder.value === 'star') return '这个邮箱还没有星标邮件';
  if (folder.value === 'out') return '这个邮箱还没有发送记录';
  if (folder.value === 'draft') return '这个邮箱没有任何草稿';
  if (folder.value === 'spam') return '这个邮箱没有垃圾邮件';
  return '这个邮箱还没有收到邮件。';
});

function selectFolder(f: Folder) {
  folder.value = f;
  detail.value = null;
  load();
}

/** 列表栏宽：和收件箱共用同一把尺子（拖过的宽度两边同步） */
const LIST_WIDTH_KEY = 'henna.list.width';
const clampListPx = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
function readListWidth() {
  const v = Number(localStorage.getItem(LIST_WIDTH_KEY));
  return Number.isFinite(v) && v > 0 ? clampListPx(v, 150, 520) : 280;
}
const listWidth = ref(readListWidth());
const isDesktop = ref(false);
let listMq: MediaQueryList | null = null;
function onListMqChange(e: MediaQueryListEvent) {
  isDesktop.value = e.matches;
}
function startListDrag(e: PointerEvent) {
  // 列表收起时分界线只剩箭头，拖动无效，点箭头展开
  if (listCollapsed.value) return;
  const startX = e.clientX;
  const startW = listWidth.value;
  const move = (ev: PointerEvent) => {
    listWidth.value = clampListPx(startW + (ev.clientX - startX), 150, 520);
  };
  const up = () => {
    localStorage.setItem(LIST_WIDTH_KEY, String(listWidth.value));
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}
/** 列表折叠：点分界线上的箭头收起/展开，收起后留 20px（约一个字宽），不与前面的边线重合；宽度记在本地，展开恢复原来宽度 */
const LIST_COLLAPSED_KEY = 'henna.list.collapsed';
const listCollapsed = ref(localStorage.getItem(LIST_COLLAPSED_KEY) === '1');
function toggleListCollapsed() {
  listCollapsed.value = !listCollapsed.value;
  localStorage.setItem(LIST_COLLAPSED_KEY, listCollapsed.value ? '1' : '0');
}
/**
 * 文件夹栏宽：默认 170px，拖右侧分界线可改（100~260px），最小 100px 刚好露出「收件箱」，记在本地；
 * 点分界线上的箭头收起/展开，收起后留 20px（约一个字宽），不与前面的边线重合，展开恢复原来宽度。
 */
const FOLDER_WIDTH_KEY = 'henna.folder.width';
const FOLDER_COLLAPSED_KEY = 'henna.folder.collapsed';
const clampFolderPx = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
function readFolderWidth() {
  const v = Number(localStorage.getItem(FOLDER_WIDTH_KEY));
  return Number.isFinite(v) && v > 0 ? clampFolderPx(v, 100, 260) : 170;
}
const folderWidth = ref(readFolderWidth());
const folderCollapsed = ref(localStorage.getItem(FOLDER_COLLAPSED_KEY) === '1');
function toggleFolderCollapsed() {
  folderCollapsed.value = !folderCollapsed.value;
  localStorage.setItem(FOLDER_COLLAPSED_KEY, folderCollapsed.value ? '1' : '0');
}
function startFolderDrag(e: PointerEvent) {
  // 文件夹收起时分界线只剩箭头，拖动无效，点箭头展开
  if (folderCollapsed.value) return;
  const startX = e.clientX;
  const startW = folderWidth.value;
  const move = (ev: PointerEvent) => {
    folderWidth.value = clampFolderPx(startW + (ev.clientX - startX), 100, 260);
  };
  const up = () => {
    localStorage.setItem(FOLDER_WIDTH_KEY, String(folderWidth.value));
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}
const folderStyle = computed(() => {
  if (!isDesktop.value) return {};
  if (folderCollapsed.value) return { width: '20px' };
  return { width: `${folderWidth.value}px` };
});

const listStyle = computed(() => {
  if (!isDesktop.value) return {};
  if (listCollapsed.value) return { width: '20px' };
  return { width: `${listWidth.value}px` };
});

onMounted(() => {
  listMq = window.matchMedia('(min-width: 768px)');
  isDesktop.value = listMq.matches;
  listMq.addEventListener('change', onListMqChange);
  load();
});
onUnmounted(() => listMq?.removeEventListener('change', onListMqChange));

// 侧栏点另一个邮箱进来时，组件会被复用：重置文件夹和详情再加载
watch(
  () => route.params.addr,
  () => {
    folder.value = 'in';
    detail.value = null;
    q.value = '';
    load();
  },
);
</script>

<template>
  <div class="flex h-full">
    <!-- 文件夹栏（桌面端） -->
    <aside class="hidden shrink-0 flex-col border-r border-sand-200 bg-white md:flex" :class="folderCollapsed ? 'overflow-hidden' : ''" :style="folderStyle">
      <div class="border-b border-sand-200 px-4 py-3">
        <RouterLink to="/" class="text-xs text-ink-500 hover:text-henna-600">‹ 返回收件箱</RouterLink>
        <div class="mt-1 truncate text-sm font-semibold text-ink-900" :title="addr">{{ addr }}</div>
      </div>
      <nav class="flex-1 space-y-1 overflow-y-auto p-3">
        <button
          v-for="f in folders"
          :key="f.key"
          class="nav-item w-full"
          :class="folder === f.key ? 'nav-item-active' : ''"
          @click="selectFolder(f.key)"
        >
          {{ f.label }}
        </button>
      </nav>
    </aside>

    <!-- 文件夹与列表之间的分界线：拖动改文件夹宽度，点中间的箭头收起/展开文件夹（仅桌面端；收起后箭头还留在这里，点一下就展开） -->
    <div
      v-if="isDesktop"
      class="relative hidden w-[5px] shrink-0 cursor-col-resize touch-none bg-sand-200 transition-colors hover:bg-henna-400 active:bg-henna-500 md:block"
      title="拖动调整文件夹宽度"
      @pointerdown="startFolderDrag"
    >
      <button
        class="absolute left-1/2 top-1/2 z-10 grid h-5 w-5 -translate-x-1/2 -translate-y-1/2 cursor-pointer place-items-center rounded-full border border-henna-200 bg-white text-henna-600 shadow-sm hover:bg-henna-50 hover:text-henna-700"
        :title="folderCollapsed ? '展开文件夹' : '收起文件夹'"
        @click.stop="toggleFolderCollapsed"
        @pointerdown.stop
      >
        <svg viewBox="0 0 24 24" class="h-3 w-3" fill="none" stroke="currentColor" stroke-width="2.5">
          <path :d="folderCollapsed ? 'M9 6l6 6-6 6' : 'M15 6l-6 6 6 6'" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
    </div>

    <!-- 列表 -->
    <section class="flex w-full flex-col md:shrink-0 md:border-r md:border-sand-200" :class="listCollapsed ? 'overflow-hidden' : ''" :style="listStyle">
      <!-- 手机端文件夹：横向滑动的一排小药丸 -->
      <div class="flex gap-1 overflow-x-auto border-b border-sand-200 bg-white px-2 py-2 md:hidden">
        <button
          v-for="f in folders"
          :key="f.key"
          class="shrink-0 rounded-full px-3 py-1.5 text-xs font-medium"
          :class="folder === f.key ? 'bg-henna-50 text-henna-600' : 'text-ink-500 hover:bg-sand-100'"
          @click="selectFolder(f.key)"
        >
          {{ f.label }}
        </button>
      </div>

      <div class="flex items-center gap-2 border-b border-sand-200 bg-white px-4 py-3">
        <span class="shrink-0 text-sm font-semibold text-ink-900">{{ folderLabel }}</span>
        <input v-model="q" class="input min-w-0 flex-1 !py-1.5 text-xs" placeholder="搜索主题 / 地址" @keyup.enter="load" />
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
              {{ folder === 'out' || folder === 'draft' ? m.to_addr : m.from_name || m.from_addr }}
            </span>
            <span class="shrink-0 text-[11px] text-ink-500">{{ fmtTime(m.created_at) }}</span>
          </div>
          <div class="mt-0.5 truncate text-sm text-ink-700">{{ m.subject || '(无主题)' }}</div>
          <div class="mt-0.5 truncate text-xs text-ink-500">{{ m.snippet ? m.snippet : '(无正文)' }}</div>
          <div class="mt-1 flex items-center gap-2 text-[11px] text-ink-500">
            <span>{{ fmtSize(m.size) }}</span>
            <span v-if="m.is_star" class="text-clay-500">★ 星标</span>
            <span v-if="m.is_spam" class="text-clay-500">垃圾邮件</span>
            <span v-if="!m.is_read" class="chip-warn">未读</span>
          </div>
        </button>
      </div>
    </section>

    <!-- 列表与详情之间的分界线：拖动改列表宽度，点中间的箭头收起/展开列表（仅桌面端；收起后箭头还留在这里，点一下就展开） -->
    <div
      v-if="isDesktop"
      class="relative hidden w-[5px] shrink-0 cursor-col-resize touch-none bg-sand-200 transition-colors hover:bg-henna-400 active:bg-henna-500 md:block"
      title="拖动调整列表宽度"
      @pointerdown="startListDrag"
    >
      <button
        class="absolute left-1/2 top-1/2 z-10 grid h-5 w-5 -translate-x-1/2 -translate-y-1/2 cursor-pointer place-items-center rounded-full border border-henna-200 bg-white text-henna-600 shadow-sm hover:bg-henna-50 hover:text-henna-700"
        :title="listCollapsed ? '展开列表' : '收起列表'"
        @click.stop="toggleListCollapsed"
        @pointerdown.stop
      >
        <svg viewBox="0 0 24 24" class="h-3 w-3" fill="none" stroke="currentColor" stroke-width="2.5">
          <path :d="listCollapsed ? 'M9 6l6 6-6 6' : 'M15 6l-6 6 6 6'" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
    </div>

    <!-- 详情：点邮件后在这里看正文 -->
    <section class="hidden min-w-0 flex-1 flex-col md:flex">
      <div v-if="!detail" class="grid flex-1 place-items-center text-sm text-ink-500">选择一封邮件查看内容</div>
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
            <button class="btn-ghost !px-2.5 !py-1.5 text-xs" @click="toggleSpam">
              {{ detail.is_spam ? '移出垃圾邮件' : '标记为垃圾邮件' }}
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
