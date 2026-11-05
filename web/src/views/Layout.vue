<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { RouterView, useRoute, useRouter } from 'vue-router';
import { api, type Address, type UserLite } from '../api';
import { clearToken, loadConfig, loadMe, logout, store, toast } from '../store';

const route = useRoute();
const router = useRouter();

/** 侧边栏折叠状态，记在本地，换设备互不影响 */
const COLLAPSE_KEY = 'henna.sidebar.collapsed';
const collapsed = ref(localStorage.getItem(COLLAPSE_KEY) === '1');
function toggleSidebar() {
  collapsed.value = !collapsed.value;
  localStorage.setItem(COLLAPSE_KEY, collapsed.value ? '1' : '0');
}

/**
 * 侧栏宽度：默认 200px，拖右侧分界线可改，170~320px 之间，
 * 170px 是「邮箱列表」那一行能完整显示的最小宽度，记在本地，刷新后还保持你拖过的宽度。
 */
const SIDEBAR_WIDTH_KEY = 'henna.sidebar.width';
const clampPx = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
function readSidebarWidth() {
  const v = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
  return Number.isFinite(v) && v > 0 ? clampPx(v, 170, 320) : 200;
}
const sidebarWidth = ref(readSidebarWidth());
const sidebarResizing = ref(false);
function startSidebarDrag(e: PointerEvent) {
  // 侧栏收起时分界线只剩箭头，拖动无效，点箭头展开
  if (collapsed.value) return;
  const startX = e.clientX;
  const startW = sidebarWidth.value;
  sidebarResizing.value = true;
  const move = (ev: PointerEvent) => {
    sidebarWidth.value = clampPx(startW + (ev.clientX - startX), 170, 320);
  };
  const up = () => {
    sidebarResizing.value = false;
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth.value));
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

const isAdmin = computed(() => store.me?.role === 'admin');

/**
 * 导航项按角色区分。
 * 普通用户只给「收件箱 / 写信」两样加左下角的「账户设置」——邮箱地址、
 * 服务商、规则、日志这些都是站点级的运维入口，不该暴露给普通用户。
 * 后端对管理接口另有 adminOnly 中间件，这里只是收窄入口。
 */
// 侧栏顺序：+邮箱、写信在上面；收件箱只给普通用户，管理员看「全部收件箱」就够了
// （桌面侧栏与移动端横向导航共用同一数组，顺序同步改）
const navs = computed((): { to: string; label: string; icon: string; primary?: boolean }[] => [
  // +邮箱在写信上面一栏：样式与 +写信一样的绿底框，点进去是邮箱管理（新建地址那页）
  ...(isAdmin.value ? [{ to: '/mail?tab=addresses', label: '邮箱', icon: 'at', primary: true }] : []),
  { to: '/compose', label: '写信', icon: 'send', primary: true },
  // 收件箱入口只给普通用户：管理员有「全部收件箱」，两个入口重复
  ...(isAdmin.value ? [] : [{ to: '/', label: '收件箱', icon: 'inbox' }]),
  /*
   * 管理项合并后只剩三个入口：
   *   全部收件箱 / 邮箱（地址+日志+分析）/ 站点管理（服务商+规则+用户+系统）
   * 邀请码独立成页，因为它日常用得多，塞在管理里每次都要多翻一层。
   */
  ...(isAdmin.value
    ? [
        { to: '/all', label: '全部收件箱', icon: 'users' },
        { to: '/mail', label: '邮箱', icon: 'at' },
        { to: '/invites', label: '邀请码', icon: 'ticket' },
        { to: '/manage', label: '站点管理', icon: 'sliders' },
      ]
    : []),
  // 账户设置不在主导航里，单独放左下角（见侧栏底部），移动端仍放在横向导航末尾
]);

// 绿底主按钮（+邮箱 / +写信）放最上面，邮箱列表紧跟在它们下面，其余导航再往下
const primaryNavs = computed(() => navs.value.filter((n) => n.primary));
const restNavs = computed(() => navs.value.filter((n) => !n.primary));

/**
 * 侧栏邮箱列表：展示所有创建的邮箱（管理员看全站，普通用户看自己的）。
 * 点地址进这个邮箱，点 ··· 弹出菜单。数据每次进页面都刷新一次，
 * 在邮箱管理页新建地址后回来，列表也会跟着更新。
 */
const mailboxes = ref<Address[]>([]);
async function loadMailboxes() {
  try {
    mailboxes.value = await api.get<Address[]>('/mailbox');
  } catch {
    mailboxes.value = [];
  }
}
/** 邮箱列表默认收起：只留标题行，点标题才展开看创建的邮箱，选择记在本地 */
const MAILBOX_LIST_KEY = 'henna.mailboxList.expanded';
const mailboxListExpanded = ref(localStorage.getItem(MAILBOX_LIST_KEY) === '1');
function toggleMailboxList() {
  mailboxListExpanded.value = !mailboxListExpanded.value;
  localStorage.setItem(MAILBOX_LIST_KEY, mailboxListExpanded.value ? '1' : '0');
}
// 正在某个邮箱里时自动展开，让当前邮箱看得见
function syncMailboxListExpanded() {
  if (route.name === 'mailbox') {
    mailboxListExpanded.value = true;
    localStorage.setItem(MAILBOX_LIST_KEY, '1');
  }
}
onMounted(() => {
  loadMailboxes();
  syncMailboxListExpanded();
});
watch(
  () => route.path,
  () => {
    loadMailboxes();
    syncMailboxListExpanded();
  },
);
function isCurrentMailbox(a: Address) {
  return route.name === 'mailbox' && decodeURIComponent(String(route.params.addr ?? '')) === a.address;
}
function goMailbox(a: Address) {
  openMenuId.value = null;
  router.push({ name: 'mailbox', params: { addr: a.address } });
}

/**
 * 三点菜单：一次只开一个，弹窗固定定位（不放在行内），
 * 直接在点的那个 ··· 正下方弹出来，不会被侧栏的窄宽度和滚动裁掉，四项都能看见。
 * 快到底部放不下时改往上弹。
 */
const openMenuId = ref<number | null>(null);
const menuPos = ref<{ top: number; left: number } | null>(null);
const menuMailbox = computed(() => mailboxes.value.find((a) => a.id === openMenuId.value) ?? null);
function toggleMenu(id: number, e: Event) {
  e.stopPropagation();
  if (openMenuId.value === id) {
    openMenuId.value = null;
    return;
  }
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const menuW = 176;
  const menuH = 170;
  // 正下方弹出：上沿贴着按钮下沿，左沿与按钮左沿（三个点里最左边那个点）对齐
  let left = r.left;
  if (left + menuW > window.innerWidth) left = window.innerWidth - menuW - 8;
  if (left < 8) left = 8;
  let top = r.bottom + 4;
  // 快到底了放不下就改往上弹
  if (top + menuH > window.innerHeight) top = Math.max(8, r.top - menuH - 4);
  menuPos.value = { top, left };
  openMenuId.value = id;
}
watch(openMenuId, (v) => {
  if (v === null) menuPos.value = null;
});

// 修改显示名称
const renameTarget = ref<Address | null>(null);
const renameValue = ref('');
function openRename(a: Address) {
  renameTarget.value = a;
  renameValue.value = a.display_name ?? '';
  openMenuId.value = null;
}
async function saveRename() {
  if (!renameTarget.value) return;
  await api.put(`/mailbox/${renameTarget.value.id}`, { display_name: renameValue.value.trim() || null });
  renameTarget.value = null;
  toast('已保存');
  await loadMailboxes();
}

// 转移邮箱（仅管理员）
const transferTarget = ref<Address | null>(null);
const transferUsers = ref<UserLite[]>([]);
const transferTo = ref('');
async function openTransfer(a: Address) {
  transferTarget.value = a;
  transferTo.value = '';
  openMenuId.value = null;
  transferUsers.value = await api.get<UserLite[]>('/admin/users');
}
async function saveTransfer() {
  if (!transferTarget.value || !transferTo.value) return;
  await api.put(`/mailbox/${transferTarget.value.id}`, { owner_id: Number(transferTo.value) });
  transferTarget.value = null;
  toast('已转移');
  await loadMailboxes();
}

// 注销邮箱：只删地址，已收到的邮件还留在原用户收件箱里
async function removeMailbox(a: Address) {
  openMenuId.value = null;
  if (!confirm(`确认注销邮箱 ${a.address}？注销后这个地址收不到新邮件，已收到的邮件不受影响。`)) return;
  await api.del(`/mailbox/${a.id}`);
  toast('已注销');
  await loadMailboxes();
  if (isCurrentMailbox(a)) router.push('/');
}

// 客户端密码说明：Henna 没有 IMAP/SMTP 客户端接入，收信走 Cloudflare，读信只在网页面板
const showClientPassInfo = ref(false);
function openClientPassInfo() {
  openMenuId.value = null;
  showClientPassInfo.value = true;
}

/** 左下角的账户设置入口（桌面侧栏底部 + 移动端横向导航末尾共用） */
const settingsNav = { to: '/settings', label: '账户设置', icon: 'gear' };
const mobileNavs = computed(() => [...navs.value, settingsNav]);

onMounted(async () => {
  await loadConfig();
  const me = await loadMe();
  // 兜底：token 失效时 /auth/me 会 401，这里把用户踢回登录页，
  // 避免顶着空侧边栏停在半死不活的状态
  if (!me) {
    clearToken();
    location.replace('/login');
  }
});

const paths: Record<string, string> = {
  inbox: 'M4 13h4l2 3h4l2-3h4M4 13l4-7h8l4 7v6H4v-6z',
  send: 'M3 11l18-7-7 18-2.5-7.5L3 11z',
  at: 'M12 15a3 3 0 100-6 3 3 0 000 6zm9-3v6a9 9 0 11-3.5-7.1',
  plug: 'M9 3v4M15 3v4M7 7h10v3a5 5 0 01-10 0V7zM12 15v6',
  route: 'M6 19a2 2 0 100-4 2 2 0 000 4zm12-10a2 2 0 100-4 2 2 0 000 4zM8 17h8a4 4 0 000-8h-2',
  list: 'M4 6h16M4 12h16M4 18h10',
  shield: 'M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6l7-3z',
  gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zm8-3a8 8 0 00-.2-1.7l1.7-1.3-1.7-3-2 .8a8 8 0 00-2.9-1.7L14.5 3h-3.4l-.4 2.1a8 8 0 00-2.9 1.7l-2-.8-1.7 3 1.7 1.3A8 8 0 004 12c0 .6.1 1.2.2 1.7l-1.7 1.3 1.7 3 2-.8a8 8 0 002.9 1.7l.4 2.1h3.4l.4-2.1a8 8 0 002.9-1.7l2 .8 1.7-3-1.7-1.3c.1-.5.2-1.1.2-1.7z',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M16 4v4M10 10v4M20 16v4',
  users: 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75',
  ticket: 'M3 9V7a2 2 0 012-2h14a2 2 0 012 2v2a2 2 0 000 4v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4a2 2 0 000-4zM13 5v14',
  collapse: 'M15 6l-6 6 6 6',
  expand: 'M9 6l6 6-6 6',
  chevronDown: 'M6 9l6 6 6-6',
};
</script>

<template>
  <div class="flex h-full">
    <!-- 侧边栏（桌面，可折叠） -->
    <aside
      class="hidden shrink-0 flex-col border-r border-sand-200 bg-white transition-[width] duration-200 md:flex"
      :class="sidebarResizing ? 'duration-0' : ''"
      :style="collapsed ? { width: '68px' } : { width: sidebarWidth + 'px' }"
    >
      <!-- 头部：点 logo / 名称回首页 -->
      <RouterLink to="/" class="flex items-center gap-2.5 px-4 py-5" :class="collapsed ? 'justify-center px-2' : ''" title="回首页">
        <img src="/logo-512.png" alt="Henna Mail" class="h-7 w-auto shrink-0" />
        <div v-if="!collapsed" class="min-w-0 flex-1 leading-tight">
          <div class="truncate text-sm font-semibold text-ink-900">{{ store.config?.appName ?? 'Henna Mail' }}</div>
          <div class="text-[11px] text-ink-500">邮箱分发系统</div>
        </div>
      </RouterLink>

      <nav class="flex-1 space-y-1 overflow-y-auto px-3">
        <RouterLink
          v-for="n in primaryNavs"
          :key="n.to"
          :to="n.to"
          class="nav-item"
          :class="{
            'nav-item-active': route.path === n.to && !n.primary,
            'justify-center !px-0': collapsed,
            '!bg-henna-500 !text-white hover:!bg-henna-600': n.primary,
            // 绿底主按钮里的文字居中显示（折叠时本来就是居中的图标）
            'justify-center': n.primary,
          }"
          :style="n.primary ? 'color: var(--brand-on, #fff)' : undefined"
         :title="collapsed ? n.label : undefined"
        >
          <svg
            v-if="!n.primary || collapsed"
            viewBox="0 0 24 24"
            class="h-4 w-4 shrink-0"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
          >
            <path :d="paths[n.icon]" stroke-linecap="round" />
          </svg>
          <span v-if="!collapsed">{{ n.primary ? '+ ' + n.label : n.label }}</span>
        </RouterLink>

        <!-- 邮箱列表：+写信下面一栏，默认收起只留标题行，点标题展开看创建的邮箱（折叠时隐藏） -->
        <div v-if="!collapsed" class="pt-2">
          <!-- 和下面收件箱同一格式的导航行：图标 + 名称，点一下展开/收起邮箱列表 -->
          <button class="nav-item mb-1 w-full" :title="mailboxListExpanded ? '收起邮箱列表' : '展开邮箱列表'" @click="toggleMailboxList">
            <svg viewBox="0 0 24 24" class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="1.8">
              <path :d="paths.inbox" stroke-linecap="round" />
            </svg>
            <span class="flex-1 text-left">邮箱列表</span>
            <span class="text-xs">{{ mailboxes.length }} 个</span>
            <svg viewBox="0 0 24 24" class="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2.5">
              <path :d="mailboxListExpanded ? paths.chevronDown : paths.expand" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
          <div v-if="mailboxListExpanded" class="max-h-64 space-y-0.5 overflow-y-auto pr-0.5">
            <div
              v-for="a in mailboxes"
              :key="a.id"
              class="relative flex items-center gap-1 rounded-lg px-1 py-1.5"
              :class="isCurrentMailbox(a) ? 'bg-henna-50' : 'hover:bg-sand-100'"
            >
              <button class="flex min-w-0 flex-1 items-center gap-2 text-left" :title="a.address" @click="goMailbox(a)">
                <span class="h-2 w-2 shrink-0 rounded-full" :class="a.enabled ? 'bg-green-500' : 'bg-sand-300'" />
                <span class="min-w-0 flex-1 leading-tight">
                  <span class="block truncate text-xs" :class="isCurrentMailbox(a) ? 'font-medium text-henna-600' : 'text-ink-700'">
                    {{ a.display_name || a.address }}
                  </span>
                  <span v-if="a.display_name" class="block truncate text-[10px] text-ink-500">{{ a.address }}</span>
                </span>
              </button>
              <button
                class="shrink-0 rounded px-1 text-sm leading-none text-ink-500 hover:bg-sand-200 hover:text-ink-900"
                title="更多操作"
                @click="toggleMenu(a.id, $event)"
              >
                ···
              </button>
            </div>
            <div v-if="!mailboxes.length" class="px-1 py-2 text-xs leading-relaxed text-ink-500">
              还没有邮箱，点上面 + 邮箱创建一个
            </div>
          </div>
        </div>

        <RouterLink
          v-for="n in restNavs"
          :key="n.to"
          :to="n.to"
          class="nav-item"
          :class="{ 'nav-item-active': route.path === n.to, 'justify-center !px-0': collapsed }"
          :title="collapsed ? n.label : undefined"
        >
          <svg viewBox="0 0 24 24" class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="1.8">
            <path :d="paths[n.icon]" stroke-linecap="round" />
          </svg>
          <span v-if="!collapsed">{{ n.label }}</span>
        </RouterLink>
      </nav>

      <!-- 账户设置：挪到左下角，用户信息上面 -->
      <div class="border-t border-sand-200 p-2">
        <RouterLink
          to="/settings"
          class="nav-item w-full"
          :class="{ 'nav-item-active': route.path === '/settings', 'justify-center !px-0': collapsed }"
          :title="collapsed ? '账户设置' : undefined"
        >
          <svg viewBox="0 0 24 24" class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="1.8">
            <path :d="paths.gear" stroke-linecap="round" />
          </svg>
          <span v-if="!collapsed">账户设置</span>
        </RouterLink>
      </div>

      <div class="border-t border-sand-200 p-3">
        <div v-if="store.me" class="mb-2 px-1">
          <div v-if="!collapsed" class="truncate text-sm font-medium text-ink-900">{{ store.me.email }}</div>
          <div v-else class="mx-auto mb-1 grid h-8 w-8 place-items-center rounded-full bg-henna-50 text-[11px] font-semibold text-henna-600">
            {{ (store.me.email[0] ?? '?').toUpperCase() }}
          </div>
          <div v-if="!collapsed" class="text-[11px] text-ink-500">
            配额 {{ store.me.used }} / {{ store.me.quota }} · {{ store.me.role }}
          </div>
        </div>
        <button class="btn-ghost w-full" :class="collapsed ? '!px-0' : ''" :title="collapsed ? '退出登录' : undefined" @click="logout">
          <svg v-if="collapsed" viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M15 17l5-5-5-5M20 12H9M12 3H5v18h7" stroke-linecap="round" />
          </svg>
          <span v-else>退出登录</span>
        </button>
      </div>
    </aside>

    <!-- 侧栏与中间栏之间的分界线：拖动改侧栏宽度，点中间的箭头收起/展开侧栏（仅桌面端；收起后箭头还留在这里，点一下就展开） -->
    <div
      class="relative hidden w-[5px] shrink-0 cursor-col-resize touch-none bg-sand-200 transition-colors hover:bg-henna-400 active:bg-henna-500 md:block"
      title="拖动调整侧栏宽度"
      @pointerdown="startSidebarDrag"
    >
      <button
        class="absolute left-1/2 top-1/2 z-10 grid h-5 w-5 -translate-x-1/2 -translate-y-1/2 cursor-pointer place-items-center rounded-full border border-sand-300 bg-white text-ink-500 shadow-sm hover:bg-sand-100 hover:text-ink-900"
        :title="collapsed ? '展开侧栏' : '收起侧栏'"
        @click.stop="toggleSidebar"
        @pointerdown.stop
      >
        <svg viewBox="0 0 24 24" class="h-3 w-3" fill="none" stroke="currentColor" stroke-width="2.5">
          <path :d="collapsed ? paths.expand : paths.collapse" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
    </div>

    <!-- 主区 -->
    <div class="flex min-w-0 flex-1 flex-col">
      <!-- 移动端顶栏 -->
      <header class="flex items-center justify-between border-b border-sand-200 bg-white px-4 py-3 md:hidden">
        <RouterLink to="/" class="flex items-center gap-2">
          <div class="grid h-8 w-8 place-items-center rounded-lg bg-henna-500" style="color: var(--brand-on, #fff)">
            <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 7h18v10H3z" />
              <path d="M3 7l9 6 9-6" />
            </svg>
          </div>
          <span class="text-sm font-semibold">{{ store.config?.appName ?? 'Henna Mail' }}</span>
        </RouterLink>
        <button class="btn-ghost !px-2 !py-1 text-xs" @click="logout">退出</button>
      </header>

      <!-- 移动端横向导航 -->
      <nav class="flex gap-1 overflow-x-auto border-b border-sand-200 bg-white px-2 py-2 md:hidden">
        <RouterLink
          v-for="n in mobileNavs"
          :key="n.to"
          :to="n.to"
          class="shrink-0 rounded-full px-3 py-1.5 text-xs font-medium text-ink-500"
          :class="
            n.primary
              ? 'bg-henna-500 text-white'
              : route.path === n.to
                ? 'bg-henna-50 text-henna-600'
                : 'hover:bg-sand-100'
          "
        >
          {{ n.primary ? '+ ' + n.label : n.label }}
        </RouterLink>
      </nav>

      <main class="min-h-0 flex-1 overflow-y-auto">
        <RouterView />
      </main>
    </div>

    <!-- 三点菜单弹窗：固定定位，在点的那个 ··· 正下方弹出，不会被侧栏裁掉；点外面任意处关掉 -->
    <div v-if="openMenuId !== null" class="fixed inset-0 z-40" @click="openMenuId = null"></div>
    <div
      v-if="menuMailbox && menuPos"
      class="fixed z-50 w-44 overflow-hidden rounded-xl border border-sand-200 bg-white py-1 shadow-lg"
      :style="{ top: menuPos.top + 'px', left: menuPos.left + 'px' }"
    >
      <button class="w-full px-3 py-2 text-left text-xs text-ink-700 hover:bg-sand-100" @click="openRename(menuMailbox)">
        修改显示名称
      </button>
      <button class="w-full px-3 py-2 text-left text-xs text-ink-700 hover:bg-sand-100" @click="openClientPassInfo">
        客户端密码
      </button>
      <button v-if="isAdmin" class="w-full px-3 py-2 text-left text-xs text-ink-700 hover:bg-sand-100" @click="openTransfer(menuMailbox)">
        转移邮箱
      </button>
      <button class="w-full px-3 py-2 text-left text-xs text-red-600 hover:bg-red-50" @click="removeMailbox(menuMailbox)">
        注销邮箱
      </button>
    </div>

    <!-- 修改显示名称 -->
    <div v-if="renameTarget" class="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" @click.self="renameTarget = null">
      <div class="w-full max-w-xs rounded-2xl bg-white p-4 shadow-xl">
        <div class="mb-1 text-sm font-semibold">修改显示名称</div>
        <div class="mb-3 text-xs leading-relaxed text-ink-500">{{ renameTarget.address }} · 只改侧栏里显示的名字，不改地址本身</div>
        <input v-model="renameValue" class="input w-full" placeholder="例如：客服邮箱" maxlength="50" @keyup.enter="saveRename" />
        <div class="mt-4 flex justify-end gap-2">
          <button class="btn-ghost" @click="renameTarget = null">取消</button>
          <button class="btn-primary" @click="saveRename">保存</button>
        </div>
      </div>
    </div>

    <!-- 转移邮箱（仅管理员） -->
    <div v-if="transferTarget" class="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" @click.self="transferTarget = null">
      <div class="w-full max-w-xs rounded-2xl bg-white p-4 shadow-xl">
        <div class="mb-1 text-sm font-semibold">转移邮箱</div>
        <div class="mb-3 text-xs leading-relaxed text-ink-500">
          {{ transferTarget.address }} · 转移后新邮件归新用户，旧邮件仍留在原用户的收件箱里
        </div>
        <select v-model="transferTo" class="input w-full">
          <option value="" disabled>选择目标用户</option>
          <option v-for="u in transferUsers" :key="u.id" :value="String(u.id)">{{ u.email }}（{{ u.role }}）</option>
        </select>
        <div class="mt-4 flex justify-end gap-2">
          <button class="btn-ghost" @click="transferTarget = null">取消</button>
          <button class="btn-primary" :disabled="!transferTo" @click="saveTransfer">转移</button>
        </div>
      </div>
    </div>

    <!-- 客户端密码说明 -->
    <div v-if="showClientPassInfo" class="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" @click.self="showClientPassInfo = false">
      <div class="w-full max-w-xs rounded-2xl bg-white p-4 shadow-xl">
        <div class="mb-1 text-sm font-semibold">客户端密码</div>
        <div class="mb-3 text-xs leading-relaxed text-ink-500">
          Henna 收信走 Cloudflare，读信只在网页面板，没有 IMAP / SMTP 客户端接入，所以没有可设的客户端密码。
          平时登录面板用的是账号密码，在左下角账户设置里改。
        </div>
        <div class="flex justify-end">
          <button class="btn-primary" @click="showClientPassInfo = false">知道了</button>
        </div>
      </div>
    </div>

  </div>
</template>
