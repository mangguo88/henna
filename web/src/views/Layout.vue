<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { RouterView, useRoute } from 'vue-router';
import { clearToken, loadConfig, loadMe, logout, store } from '../store';

const route = useRoute();

/** 侧边栏折叠状态，记在本地，换设备互不影响 */
const COLLAPSE_KEY = 'henna.sidebar.collapsed';
const collapsed = ref(localStorage.getItem(COLLAPSE_KEY) === '1');
function toggleSidebar() {
  collapsed.value = !collapsed.value;
  localStorage.setItem(COLLAPSE_KEY, collapsed.value ? '1' : '0');
}

/**
 * 侧栏宽度：默认 180px（比原来的 208px 再窄一点），拖右侧分界线可改，
 * 150~320px 之间，记在本地，刷新后还保持你拖过的宽度。
 */
const SIDEBAR_WIDTH_KEY = 'henna.sidebar.width';
const clampPx = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
function readSidebarWidth() {
  const v = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
  return Number.isFinite(v) && v > 0 ? clampPx(v, 150, 320) : 180;
}
const sidebarWidth = ref(readSidebarWidth());
const sidebarResizing = ref(false);
function startSidebarDrag(e: PointerEvent) {
  const startX = e.clientX;
  const startW = sidebarWidth.value;
  sidebarResizing.value = true;
  const move = (ev: PointerEvent) => {
    sidebarWidth.value = clampPx(startW + (ev.clientX - startX), 150, 320);
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
// 侧栏顺序：写信在收件箱上面（桌面侧栏与移动端横向导航共用同一数组，顺序同步改）
const navs = computed((): { to: string; label: string; icon: string; primary?: boolean }[] => [
  { to: '/compose', label: '写信', icon: 'send', primary: true },
  { to: '/', label: '收件箱', icon: 'inbox' },
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
      <!-- 头部：logo + 折叠按钮 -->
      <div class="flex items-center gap-2.5 px-4 py-5" :class="collapsed ? 'justify-center px-2' : ''">
        <img src="/logo-512.png" alt="Henna Mail" class="h-7 w-auto shrink-0" />
        <div v-if="!collapsed" class="min-w-0 flex-1 leading-tight">
          <div class="truncate text-sm font-semibold text-ink-900">{{ store.config?.appName ?? 'Henna Mail' }}</div>
          <div class="text-[11px] text-ink-500">邮箱分发系统</div>
        </div>
      </div>

      <nav class="flex-1 space-y-1 px-3">
        <RouterLink
          v-for="n in navs"
          :key="n.to"
          :to="n.to"
          class="nav-item"
          :class="{
            'nav-item-active': route.path === n.to && !n.primary,
            'justify-center !px-0': collapsed,
            '!bg-henna-500 !text-white hover:!bg-henna-600': n.primary,
            // 绿底写信按钮里的“+ 写信”居中显示（折叠时本来就是居中的图标）
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
          <span v-if="!collapsed">{{ n.primary ? '+ 写信' : n.label }}</span>
        </RouterLink>
      </nav>

      <!-- 折叠开关 -->
      <div class="border-t border-sand-200 p-2">
        <button
          class="nav-item w-full"
          :class="collapsed ? 'justify-center !px-0' : ''"
          :title="collapsed ? '展开侧边栏' : '收起侧边栏'"
          @click="toggleSidebar"
        >
          <svg viewBox="0 0 24 24" class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="1.8">
            <path :d="collapsed ? paths.expand : paths.collapse" stroke-linecap="round" />
          </svg>
          <span v-if="!collapsed">收起侧边栏</span>
        </button>
      </div>

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

    <!-- 侧栏与中间栏之间的可拖分界线：拖动改侧栏宽度（仅桌面端、未折叠时） -->
    <div
      v-if="!collapsed"
      class="hidden w-[5px] shrink-0 cursor-col-resize touch-none bg-sand-200 transition-colors hover:bg-henna-400 active:bg-henna-500 md:block"
      title="拖动调整侧栏宽度"
      @pointerdown="startSidebarDrag"
    ></div>

    <!-- 主区 -->
    <div class="flex min-w-0 flex-1 flex-col">
      <!-- 移动端顶栏 -->
      <header class="flex items-center justify-between border-b border-sand-200 bg-white px-4 py-3 md:hidden">
        <div class="flex items-center gap-2">
          <div class="grid h-8 w-8 place-items-center rounded-lg bg-henna-500" style="color: var(--brand-on, #fff)">
            <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 7h18v10H3z" />
              <path d="M3 7l9 6 9-6" />
            </svg>
          </div>
          <span class="text-sm font-semibold">{{ store.config?.appName ?? 'Henna Mail' }}</span>
        </div>
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
          {{ n.primary ? '+ 写信' : n.label }}
        </RouterLink>
      </nav>

      <main class="min-h-0 flex-1 overflow-y-auto">
        <RouterView />
      </main>
    </div>

  </div>
</template>
