'use strict';

/* =========================================================
   AI 革命 · control deck
   ========================================================= */

const SITE_URL = 'https://laychen-tech.github.io/blog/';
const GITHUB_URL = 'https://github.com/laychen-tech/blog';
const ACTIONS_URL = `${GITHUB_URL}/actions`;

const appEl = document.getElementById('app');
const toastsEl = document.getElementById('toasts');
const modalRoot = document.getElementById('modal-root');

const state = {
  user: null,
  overview: null,
  pendingCount: 0,
  preview: null,
  git: null,
  currentRoute: null,
  editorDirty: false,
  editorPost: null,
  viewCleanup: null,
  mdTimer: null,
};

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/* ---------- primitives ---------- */

const ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
  posts: '<path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  comments: '<path d="M4 5h16v11H9l-4 4z"/><path d="M8 9h8M8 12h5"/>',
  site: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18"/>',
  resume: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
  tag: '<path d="M3 12 12 3h8v8l-9 9z"/><circle cx="16.5" cy="7.5" r="1.2"/>',
  deploy: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 19h16"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  external: '<path d="M7 17 17 7M8 7h9v9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/>',
  edit: '<path d="m4 20 4-1 11-11-3-3L5 16z"/><path d="m13 7 3 3"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  arrow: '<path d="M5 12h14M14 7l5 5-5 5"/>',
  arrowUp: '<path d="M7 17 17 7M8 7h9v9"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 20h16"/>',
  lock: '<rect x="4" y="10" width="16" height="11"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  logout: '<path d="M10 4H4v16h6"/><path d="M14 8l4 4-4 4M18 12H9"/>',
  refresh: '<path d="M20 7v5h-5"/><path d="M4 17v-5h5"/><path d="M6.1 9a7 7 0 0 1 11.6-2.5L20 9M4 15l2.3 2.5A7 7 0 0 0 18 15"/>',
  github: '<path d="M9 19c-4 1.2-4-2.2-6-2.7M15 21v-3.4c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.7 4.7 0 0 0-1.3-3.3 4.4 4.4 0 0 0-.1-3.3s-1-.3-3.3 1.3a11.4 11.4 0 0 0-6 0C6.9 2.5 5.9 2.8 5.9 2.8a4.4 4.4 0 0 0-.1 3.3A4.7 4.7 0 0 0 4.5 9.4c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21"/>',
  image: '<rect x="3" y="4" width="18" height="16"/><circle cx="8.5" cy="9" r="1.5"/><path d="m4 18 5-5 4 4 3-3 4 4"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h14v18H6a2 2 0 0 1-2-2z"/><path d="M8 3v18"/>',
  copy: '<rect x="9" y="9" width="11" height="11"/><path d="M5 15V5h10"/>',
};

function icon(name, cls = '') {
  const path = ICONS[name] || ICONS.arrowUp;
  return `<svg${cls ? ` class="${cls}"` : ''} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}[char]));

const qs = (selector, root = document) => root.querySelector(selector);
const qsa = (selector, root = document) => [...root.querySelectorAll(selector)];

const timeZone = 'Asia/Shanghai';

function fmtDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.year}.${lookup.month}.${lookup.day}`;
}

function fmtDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.year}.${lookup.month}.${lookup.day} ${lookup.hour}:${lookup.minute}`;
}

function timeAgo(value) {
  const date = new Date(value).getTime();
  if (Number.isNaN(date)) return '';
  const diff = Math.round((Date.now() - date) / 1000);
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)} 天前`;
  return fmtDate(value);
}

function nowInputValue() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date()).replace(' ', 'T');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countChars(text) {
  const source = String(text || '');
  const cjk = (source.match(/[\u4e00-\u9fff]/g) || []).length;
  const words = source.replace(/[\u4e00-\u9fff]/g, ' ').trim().split(/\s+/).filter(Boolean).length;
  return cjk + words;
}

function parseHash() {
  const raw = location.hash.replace(/^#/, '');
  const parts = raw.split('/').filter(Boolean);
  const name = parts[0] || 'dashboard';
  if (name === 'editor') {
    return { name, id: decodeURIComponent(parts[1] || 'new'), hash: location.hash };
  }
  const known = ['dashboard', 'posts', 'comments', 'site', 'resume', 'tags', 'deploy', 'settings'];
  return { name: known.includes(name) ? name : 'dashboard', hash: location.hash };
}

/* ---------- api ---------- */

async function api(path, options = {}) {
  const headers = { Accept: 'application/json', 'X-Requested-With': 'ai-blog-admin' };
  let body;
  if (options.body instanceof FormData) {
    body = options.body;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  let response;
  try {
    response = await fetch(path, {
      method: options.method || 'GET',
      headers,
      body,
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError('网络连接失败，请检查服务是否在线。', 0);
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (response.status === 401 && options.redirectOn401 !== false) {
    state.user = null;
    state.editorDirty = false;
    renderLogin('登录已过期，请重新登录。');
    throw new ApiError('登录已过期。', 401);
  }

  if (!response.ok) {
    throw new ApiError(data?.error || `请求失败（HTTP ${response.status}）`, response.status);
  }
  return data;
}

/* ---------- toast / modal ---------- */

function toast(message, type = 'info', duration = 4200) {
  const el = document.createElement('div');
  el.className = `toast is-${type}`;
  el.textContent = message;
  toastsEl.appendChild(el);
  window.setTimeout(() => {
    el.classList.add('is-leaving');
    window.setTimeout(() => el.remove(), 260);
  }, duration);
}

function openModal({ eyebrow = 'PLEASE CONFIRM', title, body = '', actions = [], onAction }) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head">
        <div><span class="mono muted">${esc(eyebrow)}</span><h3>${esc(title)}</h3></div>
        <button type="button" class="modal-close" data-modal-close aria-label="关闭">${icon('close')}</button>
      </div>
      <div class="modal-body">${body}</div>
      ${actions.length ? `<div class="modal-actions">${actions.map((action) => `<button type="button" class="${action.className || 'btn btn-ghost'}" data-modal-action="${esc(action.value)}">${esc(action.label)}</button>`).join('')}</div>` : ''}
    </div>`;
  modalRoot.appendChild(backdrop);

  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (event) => {
    if (event.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);

  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) {
      close();
      return;
    }
    if (event.target.closest('[data-modal-close]')) {
      close();
      return;
    }
    const button = event.target.closest('[data-modal-action]');
    if (!button) return;
    const value = button.dataset.modalAction;
    if (onAction) {
      onAction(value, { close, el: backdrop });
    } else {
      close();
    }
  });

  const firstInput = qs('input, textarea', backdrop);
  if (firstInput) window.setTimeout(() => firstInput.focus(), 30);

  return { close, el: backdrop };
}

function confirmDialog({ title, message, confirmLabel = '确认', danger = false, eyebrow = 'PLEASE CONFIRM' }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const modal = openModal({
      eyebrow,
      title,
      body: `<p>${esc(message)}</p>`,
      actions: [
        { label: '取消', value: 'cancel', className: 'btn btn-ghost' },
        { label: confirmLabel, value: 'ok', className: danger ? 'btn btn-danger' : 'btn btn-solid' },
      ],
      onAction: (value) => {
        modal.close();
        finish(value === 'ok');
      },
    });
    const observer = new MutationObserver(() => {
      if (!document.body.contains(modal.el)) {
        observer.disconnect();
        finish(false);
      }
    });
    observer.observe(modalRoot, { childList: true });
  });
}

function promptDialog({ title, label, value = '', placeholder = '', confirmLabel = '保存', eyebrow = 'EDIT VALUE' }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const modal = openModal({
      eyebrow,
      title,
      body: `<label class="field"><span class="field-label">${esc(label)}</span><input class="input" data-modal-input value="${esc(value)}" placeholder="${esc(placeholder)}"></label>`,
      actions: [
        { label: '取消', value: 'cancel', className: 'btn btn-ghost' },
        { label: confirmLabel, value: 'ok', className: 'btn btn-solid' },
      ],
      onAction: (action) => {
        if (action !== 'ok') {
          modal.close();
          finish(null);
          return;
        }
        const input = qs('[data-modal-input]', modal.el);
        const next = input ? input.value.trim() : '';
        modal.close();
        finish(next);
      },
    });
    const input = qs('[data-modal-input]', modal.el);
    if (input) {
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          const next = input.value.trim();
          modal.close();
          finish(next);
        }
      });
    }
    const observer = new MutationObserver(() => {
      if (!document.body.contains(modal.el)) {
        observer.disconnect();
        finish(null);
      }
    });
    observer.observe(modalRoot, { childList: true });
  });
}

/* ---------- chrome ---------- */

function renderLogin(message = '') {
  if (state.viewCleanup) {
    try { state.viewCleanup(); } catch { /* noop */ }
    state.viewCleanup = null;
  }
  state.user = null;
  state.overview = null;
  state.editorDirty = false;
  document.title = '登录 · AI 革命控制台';
  document.body.classList.remove('nav-open');
  appEl.innerHTML = `
    <div class="login">
      <section class="login-visual">
        <div class="login-brand">
          <span class="brand-mark">AI</span>
          <div class="brand-text"><strong>AI 革命</strong><small>THE INTELLIGENCE REVOLUTION</small></div>
        </div>
        <div class="login-copy">
          <span class="eyebrow">PRIVATE CONTROL DECK</span>
          <h1>保持<em>控制。</em></h1>
          <p>写文章、审核评论、调整站点与简历信息，然后一键把变化发布到 GitHub Pages。这里是「AI 革命」的唯一后台。</p>
        </div>
        <div class="login-foot">
          <a href="${SITE_URL}" target="_blank" rel="noopener noreferrer">打开博客 ↗</a>
          <a href="${GITHUB_URL}" target="_blank" rel="noopener noreferrer">GitHub</a>
          <span>HUGO × NODE / CLOUD</span>
        </div>
      </section>
      <section class="login-side">
        <div class="login-panel">
          <span class="eyebrow">AUTHORIZED ACCESS ONLY</span>
          <h2>进入控制台</h2>
          <p>输入管理密码。会话有效期 7 天，连续失败会暂时锁定登录。</p>
          <form id="login-form" autocomplete="off">
            <label class="field">
              <span class="field-label">PASSWORD / 管理密码</span>
              <input class="input" type="password" id="login-password" autocomplete="current-password" placeholder="••••••••••" required>
            </label>
            <div class="login-error" id="login-error">${esc(message)}</div>
            <button type="submit" class="btn btn-solid btn-block" id="login-submit">解锁控制台 ${icon('arrow')}</button>
          </form>
          <p class="login-note">这个控制台与公开博客分离部署。所有文章、评论与配置都保存在云端服务器，并通过 Git 推送到 GitHub Pages。</p>
        </div>
      </section>
    </div>`;

  const form = qs('#login-form');
  const input = qs('#login-password');
  const errorEl = qs('#login-error');
  const submit = qs('#login-submit');
  input?.focus();

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorEl.textContent = '';
    const password = input.value;
    if (!password) {
      errorEl.textContent = '请输入管理密码。';
      return;
    }
    submit.disabled = true;
    submit.textContent = '正在验证…';
    try {
      await api('/api/auth/login', {
        method: 'POST',
        body: { password },
        redirectOn401: false,
      });
      const me = await api('/api/auth/me', { redirectOn401: false });
      state.user = me;
      renderShell();
      await handleRoute();
      refreshChrome();
    } catch (error) {
      errorEl.textContent = error.message || '登录失败。';
      submit.disabled = false;
      submit.innerHTML = `解锁控制台 ${icon('arrow')}`;
      input.select();
    }
  });
}

function renderShell() {
  const user = state.user || {};
  const urls = user.urls || {};
  document.title = '控制台 · AI 革命';
  document.body.classList.remove('nav-open');
  appEl.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="sidebar-head">
          <a class="brand" href="#/dashboard">
            <span class="brand-mark">AI</span>
            <span class="brand-text"><strong>AI 革命</strong><small>CONTROL DECK / v1</small></span>
          </a>
        </div>
        <nav class="sidebar-nav" aria-label="控制台导航">
          <div class="nav-group-label mono">OVERVIEW</div>
          <a class="nav-link" href="#/dashboard" data-nav="dashboard">
            ${icon('dashboard', 'nav-icon')}<span class="nav-index">01</span><span class="nav-label">总览</span>
          </a>
          <div class="nav-group-label mono">CONTENT</div>
          <a class="nav-link" href="#/posts" data-nav="posts">
            ${icon('posts', 'nav-icon')}<span class="nav-index">02</span><span class="nav-label">文章</span>
          </a>
          <a class="nav-link" href="#/comments" data-nav="comments">
            ${icon('comments', 'nav-icon')}<span class="nav-index">03</span><span class="nav-label">评论审核</span>
            <span class="nav-count hidden" id="nav-pending">0</span>
          </a>
          <div class="nav-group-label mono">PAGES</div>
          <a class="nav-link" href="#/site" data-nav="site">
            ${icon('site', 'nav-icon')}<span class="nav-index">04</span><span class="nav-label">站点设置</span>
          </a>
          <a class="nav-link" href="#/resume" data-nav="resume">
            ${icon('resume', 'nav-icon')}<span class="nav-index">05</span><span class="nav-label">简历</span>
          </a>
          <a class="nav-link" href="#/tags" data-nav="tags">
            ${icon('tag', 'nav-icon')}<span class="nav-index">06</span><span class="nav-label">标签</span>
          </a>
          <div class="nav-group-label mono">SHIP</div>
          <a class="nav-link" href="#/deploy" data-nav="deploy">
            ${icon('deploy', 'nav-icon')}<span class="nav-index">07</span><span class="nav-label">发布部署</span>
          </a>
          <a class="nav-link" href="#/settings" data-nav="settings">
            ${icon('settings', 'nav-icon')}<span class="nav-index">08</span><span class="nav-label">设置</span>
          </a>
        </nav>
        <div class="sidebar-foot">
          <a class="side-link" href="${esc(urls.site || SITE_URL)}" target="_blank" rel="noopener noreferrer"><span>打开博客</span>${icon('arrowUp')}</a>
          <a class="side-link" href="${esc(urls.preview || '/preview/')}" target="_blank" rel="noopener noreferrer"><span>预览最新构建</span>${icon('arrowUp')}</a>
          <a class="side-link" href="${GITHUB_URL}" target="_blank" rel="noopener noreferrer"><span>GitHub 仓库</span>${icon('arrowUp')}</a>
          <button class="side-link" type="button" data-logout><span>锁定控制台</span>${icon('logout')}</button>
          <div class="sidebar-status">
            <span class="dot" id="sidebar-dot"></span>
            <span id="sidebar-status-text">CHECKING SYSTEM</span>
          </div>
        </div>
      </aside>
      <div class="main">
        <header class="topbar">
          <div class="topbar-left">
            <button class="mobile-toggle" type="button" data-menu-toggle aria-label="打开导航">${icon('menu')}</button>
            <div>
              <div class="topbar-eyebrow mono" id="topbar-eyebrow">CONTROL DECK</div>
              <h1 class="topbar-title" id="topbar-title">总览</h1>
            </div>
          </div>
          <div class="topbar-actions">
            <div class="topbar-status">
              <span class="dot" id="topbar-dot"></span>
              <span id="topbar-status-text">PREVIEW</span>
            </div>
            <a class="btn btn-ghost" href="${esc(urls.site || SITE_URL)}" target="_blank" rel="noopener noreferrer">${icon('external')}<span>打开博客</span></a>
            <a class="btn btn-solid" href="#/deploy">${icon('upload')}<span>一键发布</span></a>
          </div>
        </header>
        <main class="view" id="view"></main>
      </div>
      <div class="sidebar-overlay" data-overlay></div>
    </div>`;

  const body = document.body;
  qs('[data-menu-toggle]')?.addEventListener('click', () => body.classList.toggle('nav-open'));
  qs('[data-overlay]')?.addEventListener('click', () => body.classList.remove('nav-open'));
  qs('[data-logout]')?.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: '锁定控制台？',
      message: '当前会话将立即结束，需要重新输入密码才能继续。',
      confirmLabel: '锁定',
    });
    if (!ok) return;
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {
      /* the cookie is cleared client-side on the next login anyway */
    }
    renderLogin();
  });
}

function setTopbar(eyebrow, title) {
  const eyebrowEl = qs('#topbar-eyebrow');
  const titleEl = qs('#topbar-title');
  if (eyebrowEl) eyebrowEl.textContent = eyebrow;
  if (titleEl) titleEl.textContent = title;
  document.title = `${title} · AI 革命控制台`;
}

function setActiveNav(name) {
  qsa('[data-nav]').forEach((link) => {
    link.classList.toggle('is-active', link.dataset.nav === name);
  });
}

function applyOverviewChrome(data) {
  if (!data) return;
  state.overview = data;
  const pending = data.stats?.comments?.pending ?? 0;
  state.pendingCount = pending;
  const badge = qs('#nav-pending');
  if (badge) {
    badge.textContent = String(pending);
    badge.classList.toggle('hidden', pending === 0);
  }
  if (data.preview) updatePreviewChrome(data.preview);
  if (data.git) updateGitChrome(data.git);
}

function previewLabel(preview) {
  if (!preview) return { text: 'PREVIEW UNKNOWN', dot: '' };
  if (preview.building) return { text: 'BUILDING PREVIEW', dot: 'is-live' };
  if (preview.lastError) return { text: 'BUILD FAILED', dot: 'is-bad' };
  if (preview.release) return { text: 'PREVIEW READY', dot: 'is-ok' };
  return { text: 'NO PREVIEW', dot: 'is-warn' };
}

function updatePreviewChrome(preview) {
  state.preview = preview;
  const label = previewLabel(preview);
  const dot = qs('#topbar-dot');
  const text = qs('#topbar-status-text');
  if (dot) dot.className = `dot ${label.dot}`;
  if (text) text.textContent = label.text;
}

function updateGitChrome(git) {
  state.git = git;
  const dot = qs('#sidebar-dot');
  const text = qs('#sidebar-status-text');
  if (!dot || !text) return;
  if (!git || git.error) {
    dot.className = 'dot is-bad';
    text.textContent = 'GIT UNAVAILABLE';
    return;
  }
  if (git.changeCount > 0) {
    dot.className = 'dot is-warn';
    text.textContent = `${git.changeCount} CHANGES PENDING`;
    return;
  }
  dot.className = 'dot is-ok';
  text.textContent = 'ALL CHANGES SHIPPED';
}

async function refreshChrome() {
  try {
    const data = await api('/api/admin/overview');
    applyOverviewChrome(data);
  } catch {
    /* chrome is informational only */
  }
}

/* ---------- router ---------- */

async function handleRoute() {
  if (!state.user) return;
  if (state.viewCleanup) {
    try { state.viewCleanup(); } catch { /* noop */ }
    state.viewCleanup = null;
  }
  if (state.mdTimer) {
    clearTimeout(state.mdTimer);
    state.mdTimer = null;
  }

  const route = parseHash();
  state.currentRoute = route;
  setActiveNav(route.name);
  document.body.classList.remove('nav-open');
  const viewEl = qs('#view');
  if (!viewEl) return;
  viewEl.innerHTML = `<div class="view-inner"><div class="loading-block"><span class="spinner"></span><span class="mono">LOADING / ${esc(route.name.toUpperCase())}</span></div></div>`;

  const handlers = {
    dashboard: viewDashboard,
    posts: viewPosts,
    editor: viewEditor,
    comments: viewComments,
    site: viewSite,
    resume: viewResume,
    tags: viewTags,
    deploy: viewDeploy,
    settings: viewSettings,
  };

  try {
    await handlers[route.name](route);
  } catch (error) {
    if (error.status === 401) return;
    viewEl.innerHTML = `
      <div class="view-inner view-enter">
        <div class="error-block">
          <strong>页面加载失败</strong>
          <p>${esc(error.message || '未知错误')}</p>
          <button type="button" class="btn btn-ghost" data-retry>重新加载</button>
        </div>
      </div>`;
    qs('[data-retry]')?.addEventListener('click', handleRoute);
  }
}

window.addEventListener('hashchange', async () => {
  if (!state.user) return;
  if (state.currentRoute?.name === 'editor' && state.editorDirty) {
    const ok = window.confirm('当前文章有未保存的修改，确定离开？');
    if (!ok) {
      history.replaceState(null, '', state.currentRoute.hash);
      return;
    }
    state.editorDirty = false;
  }
  await handleRoute();
});

window.addEventListener('beforeunload', (event) => {
  if (state.editorDirty) {
    event.preventDefault();
    event.returnValue = '';
  }
});

/* ---------- dashboard ---------- */

async function viewDashboard() {
  setTopbar('CONTROL DECK / OVERVIEW', '总览');
  const data = await api('/api/admin/overview');
  applyOverviewChrome(data);
  const stats = data.stats;
  const counts = stats.comments;
  const preview = data.preview;
  const git = data.git;
  const hour = Number(new Intl.DateTimeFormat('zh-CN', { timeZone, hour: '2-digit', hour12: false }).format(new Date()));
  const greeting = hour < 6 ? '夜深了' : hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';
  const previewMeta = previewLabel(preview);
  const pending = data.pendingComments || [];
  const recent = data.recentPosts || [];

  const viewEl = qs('#view');
  viewEl.innerHTML = `
    <div class="view-inner view-enter">
      <section class="hero-strip">
        <div class="hero-copy">
          <span class="eyebrow">${fmtDate(new Date())} · 云端控制台</span>
          <h2>${greeting}，<em>Gavin</em>。</h2>
          <p>${stats.drafts > 0 ? `有 ${stats.drafts} 篇草稿等待完成。` : '所有草稿都已处理。'}${counts.pending > 0 ? ` 另有 ${counts.pending} 条评论等待审核。` : ' 评论区当前没有待审内容。'}</p>
        </div>
        <div class="hero-actions">
          <a class="btn btn-ghost" href="#/comments">审核评论</a>
          <a class="btn btn-solid" href="#/editor/new">${icon('plus')} 写新文章</a>
        </div>
      </section>

      <section class="stats-grid">
        <div class="stat-card">
          <span class="stat-label">PUBLISHED / 已发布</span>
          <span class="stat-value">${stats.published}<small>篇</small></span>
          <span class="stat-foot">共 ${stats.posts} 篇 · 草稿 ${stats.drafts} 篇</span>
        </div>
        <div class="stat-card ${counts.pending > 0 ? 'is-alert' : ''}">
          <span class="stat-label">MODERATION / 待审核</span>
          <span class="stat-value">${counts.pending}<small>条</small></span>
          <span class="stat-foot">已显示 ${counts.approved} 条 · 全部 ${counts.all} 条</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">TOPICS / 标签</span>
          <span class="stat-value">${stats.tags}<small>个</small></span>
          <span class="stat-foot">在文章与主题索引中使用</span>
        </div>
        <div class="stat-card ${git?.changeCount ? 'is-alert' : ''}">
          <span class="stat-label">UNSHIPPED / 待发布</span>
          <span class="stat-value">${git?.error ? '—' : git?.changeCount ?? 0}<small>文件</small></span>
          <span class="stat-foot">${git?.error ? 'Git 状态不可用' : git?.clean ? '工作区干净' : '有本地改动尚未推送'}</span>
        </div>
      </section>

      <div class="dashboard-grid">
        <div class="dash-stack">
          <section class="panel">
            <div class="panel-head">
              <h3>最近文章</h3>
              <a class="btn-link" href="#/posts">全部文章 ↗</a>
            </div>
            <div class="recent-list">
              ${recent.length ? recent.map((post, index) => `
                <a class="recent-row" href="#/editor/${encodeURIComponent(post.id)}">
                  <span class="recent-index">${String(index + 1).padStart(2, '0')}</span>
                  <span class="recent-main">
                    <span class="recent-title">${esc(post.title)}</span>
                    <span class="recent-meta"><span>${fmtDate(post.date)}</span><span>${post.tags.slice(0, 3).map((tag) => `#${esc(tag)}`).join(' ')}</span></span>
                  </span>
                  <span>${post.draft ? '<span class="badge is-draft">草稿</span>' : '<span class="badge is-published">已发布</span>'}</span>
                  <span class="recent-arrow">${icon('arrowUp')}</span>
                </a>`).join('') : `<div class="empty"><strong>还没有文章</strong><p>写下第一篇观察，让博客开始运转。</p><a class="btn btn-solid" href="#/editor/new">${icon('plus')} 写新文章</a></div>`}
            </div>
          </section>

          <section class="panel">
            <div class="panel-head">
              <h3>待审核评论</h3>
              <div class="mono muted">${counts.pending} PENDING</div>
            </div>
            <div class="pending-list">
              ${pending.length ? pending.map((comment) => `
                <div class="pending-item">
                  <div class="pending-head">
                    <span class="pending-author">${esc(comment.author)}</span>
                    <span class="pending-post">${esc(comment.post_title || comment.post)}</span>
                    <span class="pending-time">${esc(comment.relative || timeAgo(comment.created_at))}</span>
                  </div>
                  <p class="pending-content">${esc(comment.content)}</p>
                  <div class="pending-foot">
                    <span class="pending-time">${comment.email ? esc(comment.email) : '未留邮箱'}</span>
                    <div>
                      <button class="btn btn-sm btn-ghost" type="button" data-approve="${esc(comment.id)}">${icon('check')} 通过</button>
                      <button class="btn btn-sm btn-ghost" type="button" data-hide="${esc(comment.id)}">隐藏</button>
                    </div>
                  </div>
                </div>`).join('') : `<div class="empty"><strong>暂无待审核评论</strong><p>新的评论会先进入这里，通过后才会出现在公开页面。</p><a class="btn btn-ghost" href="#/comments">查看全部评论</a></div>`}
            </div>
          </section>
        </div>

        <aside class="dash-stack">
          <section class="panel">
            <div class="panel-head"><h3>系统状态</h3><span class="mono muted">SYSTEM</span></div>
            <div class="status-list">
              <div class="status-item">
                <span class="dot ${previewMeta.dot}"></span>
                <div class="status-copy"><span class="status-label">PREVIEW BUILD</span><span class="status-value">${preview.building ? '正在构建预览' : preview.lastError ? `构建失败：${esc(preview.lastError.slice(0, 100))}` : preview.builtAt ? `就绪 · ${fmtDateTime(preview.builtAt)}` : '尚未构建'}</span></div>
              </div>
              <div class="status-item">
                <span class="dot ${git?.error ? 'is-bad' : git?.clean ? 'is-ok' : 'is-warn'}"></span>
                <div class="status-copy"><span class="status-label">GIT / ${esc(git?.branch || 'UNKNOWN')}</span><span class="status-value">${git?.error ? esc(git.error) : git?.lastCommit ? `${esc(git.lastCommit.short)} · ${esc(git.lastCommit.subject)}` : '尚无提交记录'}</span></div>
              </div>
              <div class="status-item">
                <span class="dot is-live"></span>
                <div class="status-copy"><span class="status-label">PUBLIC SITE</span><span class="status-value">${esc(data.urls.site)}</span></div>
              </div>
            </div>
            <div class="quick-links">
              <a class="quick-link" href="${GITHUB_URL}" target="_blank" rel="noopener noreferrer">GitHub ${icon('external')}</a>
              <a class="quick-link" href="#/deploy">发布部署 ${icon('arrow')}</a>
              <a class="quick-link" href="${esc(data.urls.preview || '/preview/')}" target="_blank" rel="noopener noreferrer">预览构建 ${icon('external')}</a>
              <a class="quick-link" href="#/settings">控制台设置 ${icon('arrow')}</a>
            </div>
          </section>

          <section class="panel">
            <div class="panel-head"><h3>快速操作</h3><span class="mono muted">QUICK</span></div>
            <div class="panel-body" style="display:flex;flex-direction:column;gap:8px">
              <a class="btn btn-ghost btn-block" href="#/editor/new">${icon('plus')} 新建文章</a>
              <a class="btn btn-ghost btn-block" href="#/site">${icon('site')} 更新站点信息</a>
              <a class="btn btn-ghost btn-block" href="#/resume">${icon('resume')} 编辑简历</a>
              <a class="btn btn-ghost btn-block" href="#/deploy">${icon('upload')} 发布最新变化</a>
            </div>
          </section>
        </aside>
      </div>
    </div>`;

  qsa('[data-approve]').forEach((button) => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await api(`/api/admin/comments/${encodeURIComponent(button.dataset.approve)}`, {
          method: 'PATCH',
          body: { status: 'approved' },
        });
        toast('评论已通过，将显示在公开页面。', 'ok');
        await viewDashboard();
        refreshChrome();
      } catch (error) {
        toast(error.message, 'error');
        button.disabled = false;
      }
    });
  });
  qsa('[data-hide]').forEach((button) => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await api(`/api/admin/comments/${encodeURIComponent(button.dataset.hide)}`, {
          method: 'PATCH',
          body: { status: 'hidden' },
        });
        toast('评论已隐藏。', 'ok');
        await viewDashboard();
        refreshChrome();
      } catch (error) {
        toast(error.message, 'error');
        button.disabled = false;
      }
    });
  });
}

/* ---------- posts ---------- */

async function viewPosts() {
  setTopbar('CONTENT / POSTS', '文章');
  const data = await api('/api/admin/posts');
  const filters = { status: 'all', search: '' };
  const viewEl = qs('#view');
  viewEl.innerHTML = `
    <div class="view-inner view-enter">
      <header class="page-head">
        <div class="page-head-copy">
          <span class="eyebrow">CORPUS / ${String(data.counts.all).padStart(2, '0')} ENTRIES</span>
          <h2>文章库</h2>
          <p>所有观察、草稿与阶段性判断。保存后会立即构建预览，发布后同步到 GitHub Pages。</p>
        </div>
        <div class="page-actions">
          <a class="btn btn-solid" href="#/editor/new">${icon('plus')} 写新文章</a>
        </div>
      </header>
      <div class="toolbar">
        <div class="tabs">
          <button class="tab is-active" type="button" data-filter="all">全部 <span>${data.counts.all}</span></button>
          <button class="tab" type="button" data-filter="published">已发布 <span>${data.counts.published}</span></button>
          <button class="tab" type="button" data-filter="drafts">草稿 <span>${data.counts.drafts}</span></button>
        </div>
        <label class="search-field">
          ${icon('search')}
          <input class="input" type="search" placeholder="搜索标题或标签…" data-post-search>
        </label>
      </div>
      <div class="posts-table">
        <div class="posts-table-head"><span>NO.</span><span>TITLE</span><span>DATE</span><span>READ</span><span>ACTIONS</span></div>
        <div id="posts-rows"></div>
      </div>
    </div>`;

  const rowsRoot = qs('#posts-rows');
  const searchInput = qs('[data-post-search]');

  const renderRows = () => {
    const query = filters.search.trim().toLowerCase();
    const items = data.posts.filter((post) => {
      if (filters.status === 'published' && post.draft) return false;
      if (filters.status === 'drafts' && !post.draft) return false;
      if (!query) return true;
      return `${post.title} ${post.tags.join(' ')} ${post.id}`.toLowerCase().includes(query);
    });

    if (!items.length) {
      rowsRoot.innerHTML = `<div class="empty"><strong>没有匹配的文章</strong><p>换一个关键词，或开始写一篇新的观察。</p><a class="btn btn-solid" href="#/editor/new">${icon('plus')} 写新文章</a></div>`;
      return;
    }

    rowsRoot.innerHTML = items.map((post, index) => `
      <div class="posts-row">
        <span class="posts-index">${String(index + 1).padStart(2, '0')}</span>
        <div>
          <a class="posts-title" href="#/editor/${encodeURIComponent(post.id)}">${esc(post.title)}</a>
          <div class="posts-tags">${post.tags.slice(0, 5).map((tag) => `<span>#${esc(tag)}</span>`).join('')}</div>
        </div>
        <span class="posts-date">${fmtDate(post.date)}</span>
        <span class="posts-read">${post.readingTime} MIN · ${post.wordCount} 字</span>
        <div class="posts-actions">
          <a class="icon-btn" href="#/editor/${encodeURIComponent(post.id)}" title="编辑">${icon('edit')}</a>
          <a class="icon-btn" href="${esc((state.user?.urls?.preview || '/preview/').replace(/\/?$/, '/'))}posts/${encodeURIComponent(post.id)}/" target="_blank" rel="noopener noreferrer" title="预览">${icon('eye')}</a>
          <button class="icon-btn is-danger" type="button" data-delete-post="${esc(post.id)}" title="删除">${icon('trash')}</button>
        </div>
      </div>`).join('');

    qsa('[data-delete-post]', rowsRoot).forEach((button) => {
      button.addEventListener('click', async () => {
        const id = button.dataset.deletePost;
        const post = data.posts.find((item) => item.id === id);
        const ok = await confirmDialog({
          title: '删除这篇文章？',
          message: `「${post?.title || id}」将被移入服务器回收目录。删除后需要重新发布才会从线上消失。`,
          confirmLabel: '移至回收站',
          danger: true,
        });
        if (!ok) return;
        try {
          await api(`/api/admin/posts/${encodeURIComponent(id)}`, { method: 'DELETE' });
          toast('文章已移入回收目录。', 'ok');
          await viewPosts();
          refreshChrome();
        } catch (error) {
          toast(error.message, 'error');
        }
      });
    });
  };

  qsa('[data-filter]').forEach((tab) => {
    tab.addEventListener('click', () => {
      filters.status = tab.dataset.filter;
      qsa('[data-filter]').forEach((item) => item.classList.toggle('is-active', item === tab));
      renderRows();
    });
  });

  searchInput.addEventListener('input', () => {
    filters.search = searchInput.value;
    renderRows();
  });

  renderRows();
}

/* ---------- editor ---------- */

function newPostDraft() {
  return {
    id: '',
    title: '',
    body: '',
    dateLocal: nowInputValue(),
    draft: true,
    featured: false,
    tags: [],
    summary: '',
    cover: '',
    previewUrl: '',
    publicUrl: '',
    updatedAt: null,
  };
}

async function viewEditor(route) {
  state.editorDirty = false;
  const isNew = route.id === 'new';
  let post;
  if (isNew) {
    post = newPostDraft();
  } else {
    const data = await api(`/api/admin/posts/${encodeURIComponent(route.id)}`);
    post = data.post;
  }
  state.editorPost = post;
  setTopbar(isNew ? 'WRITING DESK / NEW ENTRY' : 'WRITING DESK / EDIT ENTRY', isNew ? '新文章' : '编辑文章');

  const previewBase = (state.user?.urls?.preview || '/preview/').replace(/\/?$/, '/');
  const previewUrl = post.id ? `${previewBase}posts/${encodeURIComponent(post.id)}/` : '';
  const publicUrl = post.id ? `${SITE_URL}posts/${encodeURIComponent(post.id)}/` : '';
  const draft = Boolean(post.draft);

  const viewEl = qs('#view');
  viewEl.innerHTML = `
    <div class="view-inner view-enter">
      <div class="editor-layout">
        <section class="editor-main">
          <div class="editor-head">
            <div class="editor-subline" style="margin-top:0">
              <a href="#/posts">← 文章库</a>
              <span>/</span>
              <span id="editor-file">${post.id ? `content/posts/${esc(post.id)}.md` : '尚未保存'}</span>
              <span id="editor-dirty" class="accent"></span>
            </div>
            <input class="editor-title-input" id="post-title" type="text" maxlength="140" placeholder="文章标题" value="${esc(post.title)}">
            <div class="editor-subline">
              <span class="dot ${draft ? 'is-warn' : 'is-ok'}" id="editor-status-dot"></span>
              <span id="editor-status-text">${draft ? '草稿' : '已发布'}</span>
              <span>·</span>
              <span id="editor-word-count">${countChars(post.body)} 字</span>
              <span>·</span>
              <span id="editor-save-state">${post.updatedAt ? `最后保存 ${fmtDateTime(post.updatedAt)}` : '尚未保存'}</span>
            </div>
          </div>
          <div class="editor-tabs">
            <div class="tabs">
              <button class="editor-tab is-active" type="button" data-editor-tab="write">正文</button>
              <button class="editor-tab" type="button" data-editor-tab="preview">实时预览</button>
            </div>
            <div class="md-tools">
              <button class="md-tool" type="button" data-md="h2" title="二级标题">H2</button>
              <button class="md-tool" type="button" data-md="bold" title="加粗"><b>B</b></button>
              <button class="md-tool" type="button" data-md="italic" title="斜体"><i>I</i></button>
              <button class="md-tool" type="button" data-md="quote" title="引用">“”</button>
              <button class="md-tool" type="button" data-md="code" title="行内代码">&lt;/&gt;</button>
              <button class="md-tool" type="button" data-md="link" title="链接">↗</button>
              <button class="md-tool" type="button" data-md="image" title="插入图片">${icon('image')}</button>
              <button class="md-tool" type="button" data-md="hr" title="分隔线">—</button>
            </div>
          </div>
          <div id="pane-write">
            <textarea class="editor-textarea" id="post-body" spellcheck="false" placeholder="从一个判断开始。支持 Markdown、代码块、引用与图片。">${esc(post.body)}</textarea>
          </div>
          <div id="pane-preview" class="hidden">
            <div class="md-preview" id="md-preview"><p class="muted">正在准备预览…</p></div>
          </div>
          <div class="editor-foot">
            <span>MARKDOWN / FRONT MATTER AUTO-SAVED</span>
            <span id="editor-char-count">${String(post.body.length)} 字符</span>
          </div>
        </section>

        <aside class="editor-side">
          <section class="side-panel">
            <div class="side-panel-head"><h3>发布</h3><span class="badge ${draft ? 'is-draft' : 'is-published'}" id="status-badge">${draft ? 'DRAFT' : 'LIVE'}</span></div>
            <div class="side-panel-body">
              <div class="field">
                <span class="field-label">文章状态</span>
                <div class="segmented" id="status-segmented">
                  <button type="button" data-draft="true" class="${draft ? 'is-active' : ''}">草稿</button>
                  <button type="button" data-draft="false" class="${!draft ? 'is-active' : ''}">发布</button>
                </div>
              </div>
              <label class="field">
                <span class="field-label">发布日期</span>
                <input class="input" type="datetime-local" id="post-date" value="${esc(post.dateLocal || nowInputValue())}">
              </label>
              <label class="checkbox"><input type="checkbox" id="post-featured" ${post.featured ? 'checked' : ''}> 设为首页精选文章</label>
              <button class="btn btn-solid btn-block" type="button" id="save-post">${icon('check')} 保存更改</button>
              <button class="btn btn-ghost btn-block" type="button" id="open-preview">${icon('eye')} 打开页面预览</button>
              <button class="btn btn-danger btn-block ${isNew ? 'hidden' : ''}" type="button" id="delete-post">${icon('trash')} 删除文章</button>
            </div>
          </section>

          <section class="side-panel">
            <div class="side-panel-head"><h3>文章设置</h3><span class="mono muted">META</span></div>
            <div class="side-panel-body">
              <label class="field">
                <span class="field-label">文章 ID / URL</span>
                <span class="input-prefix"><span>/posts/</span><input class="input" id="post-slug" value="${esc(post.id)}" placeholder="auto-generated" ${isNew ? '' : 'data-locked'}></span>
                <span class="field-hint">${isNew ? '留空自动生成。仅限小写字母、数字与连字符。' : '修改会改变文章 URL；评论会随之迁移。'}</span>
              </label>
              <label class="field">
                <span class="field-label">标签</span>
                <input class="input" id="post-tags" value="${esc(post.tags.join(', '))}" placeholder="AI 革命, 思考">
                <span class="field-hint">用逗号分隔，最多 8 个。</span>
              </label>
              <label class="field">
                <span class="field-label">摘要</span>
                <textarea class="textarea" id="post-summary" rows="4" placeholder="留空则由正文自动生成">${esc(post.summary)}</textarea>
              </label>
              <div class="field">
                <span class="field-label">封面图</span>
                <div class="cover-preview" id="cover-preview">${post.cover ? `<img src="${esc(post.cover)}" alt="">` : 'NO COVER / 使用生成式封面'}</div>
                <input class="input" id="post-cover" value="${esc(post.cover)}" placeholder="/uploads/... 或 https://...">
                <div class="cover-actions">
                  <button class="btn btn-ghost btn-sm" type="button" id="cover-upload">${icon('upload')} 上传封面</button>
                  <button class="btn-link" type="button" id="cover-clear">清除</button>
                </div>
              </div>
            </div>
          </section>

          <section class="side-panel">
            <div class="side-panel-head"><h3>链接</h3><span class="mono muted">LINKS</span></div>
            <div class="panel-body" style="padding:14px 16px;display:flex;flex-direction:column;gap:9px">
              <a class="btn-link" href="${previewUrl || '#'}" id="preview-link" ${previewUrl ? 'target="_blank" rel="noopener noreferrer"' : 'aria-disabled="true"'} style="${previewUrl ? '' : 'opacity:.4;pointer-events:none'}">打开预览页 ↗</a>
              <a class="btn-link" href="${publicUrl || '#'}" id="public-link" ${publicUrl ? 'target="_blank" rel="noopener noreferrer"' : 'aria-disabled="true"'} style="${publicUrl ? '' : 'opacity:.4;pointer-events:none'}">打开线上页 ↗</a>
              <a class="btn-link" href="#/deploy">前往发布面板 ↗</a>
              <span class="field-hint" id="editor-preview-state">${post.id ? '保存后会重建预览。' : '保存后才会生成页面。'}</span>
            </div>
          </section>
        </aside>
      </div>
      <input type="file" id="inline-image-input" accept="image/png,image/jpeg,image/gif,image/webp" class="hidden">
      <input type="file" id="cover-image-input" accept="image/png,image/jpeg,image/gif,image/webp" class="hidden">
    </div>`;

  const titleEl = qs('#post-title');
  const bodyEl = qs('#post-body');
  const dateEl = qs('#post-date');
  const tagsEl = qs('#post-tags');
  const summaryEl = qs('#post-summary');
  const slugEl = qs('#post-slug');
  const coverEl = qs('#post-cover');
  const featuredEl = qs('#post-featured');
  const dirtyEl = qs('#editor-dirty');
  const saveStateEl = qs('#editor-save-state');
  const wordEl = qs('#editor-word-count');
  const charEl = qs('#editor-char-count');
  const badgeEl = qs('#status-badge');
  const statusDot = qs('#editor-status-dot');
  const statusText = qs('#editor-status-text');
  let draftStatus = Boolean(post.draft);
  let currentId = post.id;

  const markDirty = () => {
    state.editorDirty = true;
    if (dirtyEl) dirtyEl.textContent = '● 未保存';
  };

  const syncStatus = () => {
    if (badgeEl) {
      badgeEl.textContent = draftStatus ? 'DRAFT' : 'LIVE';
      badgeEl.className = `badge ${draftStatus ? 'is-draft' : 'is-published'}`;
    }
    if (statusDot) statusDot.className = `dot ${draftStatus ? 'is-warn' : 'is-ok'}`;
    if (statusText) statusText.textContent = draftStatus ? '草稿' : '已发布';
  };

  const updateCounts = () => {
    const value = bodyEl.value;
    if (wordEl) wordEl.textContent = `${countChars(value)} 字`;
    if (charEl) charEl.textContent = `${value.length} 字符`;
  };

  const updateCoverPreview = () => {
    const preview = qs('#cover-preview');
    const value = coverEl.value.trim();
    if (preview) {
      preview.innerHTML = value ? `<img src="${esc(value)}" alt="">` : 'NO COVER / 使用生成式封面';
    }
  };

  const updateLinks = (nextPost) => {
    const base = (state.user?.urls?.preview || '/preview/').replace(/\/?$/, '/');
    const previewUrl = nextPost?.id ? `${base}posts/${encodeURIComponent(nextPost.id)}/` : '';
    const publicUrl = nextPost?.id ? `${SITE_URL}posts/${encodeURIComponent(nextPost.id)}/` : '';
    const previewLink = qs('#preview-link');
    const publicLink = qs('#public-link');
    if (previewLink && previewUrl) {
      previewLink.href = previewUrl;
      previewLink.target = '_blank';
      previewLink.rel = 'noopener noreferrer';
      previewLink.style = '';
    }
    if (publicLink && publicUrl) {
      publicLink.href = publicUrl;
      publicLink.target = '_blank';
      publicLink.rel = 'noopener noreferrer';
      publicLink.style = '';
    }
    const fileEl = qs('#editor-file');
    if (fileEl && nextPost?.id) fileEl.textContent = `content/posts/${nextPost.id}.md`;
  };

  const scheduleMarkdown = () => {
    if (qs('#pane-preview')?.classList.contains('hidden')) return;
    clearTimeout(state.mdTimer);
    state.mdTimer = setTimeout(async () => {
      try {
        const result = await api('/api/admin/markdown', {
          method: 'POST',
          body: { markdown: bodyEl.value },
        });
        const preview = qs('#md-preview');
        if (preview) preview.innerHTML = result.html || '<p class="muted">正文为空。</p>';
      } catch (error) {
        if (error.status !== 401) {
          const preview = qs('#md-preview');
          if (preview) preview.innerHTML = `<p class="danger-text">${esc(error.message)}</p>`;
        }
      }
    }, 320);
  };

  [titleEl, dateEl, tagsEl, summaryEl, coverEl].forEach((input) => {
    input?.addEventListener('input', markDirty);
    input?.addEventListener('change', markDirty);
  });
  featuredEl?.addEventListener('change', markDirty);
  bodyEl?.addEventListener('input', () => {
    markDirty();
    updateCounts();
    scheduleMarkdown();
  });
  coverEl?.addEventListener('input', updateCoverPreview);

  qsa('[data-draft]').forEach((button) => {
    button.addEventListener('click', () => {
      draftStatus = button.dataset.draft === 'true';
      qsa('[data-draft]').forEach((item) => item.classList.toggle('is-active', item === button));
      syncStatus();
      markDirty();
    });
  });

  qsa('[data-editor-tab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      const which = tab.dataset.editorTab;
      qsa('[data-editor-tab]').forEach((item) => item.classList.toggle('is-active', item === tab));
      qs('#pane-write')?.classList.toggle('hidden', which !== 'write');
      qs('#pane-preview')?.classList.toggle('hidden', which !== 'preview');
      if (which === 'preview') scheduleMarkdown();
    });
  });

  const focusBody = () => {
    if (qs('#pane-write')?.classList.contains('hidden')) {
      qsa('[data-editor-tab]').forEach((item) => item.classList.toggle('is-active', item.dataset.editorTab === 'write'));
      qs('#pane-write')?.classList.remove('hidden');
      qs('#pane-preview')?.classList.add('hidden');
    }
    bodyEl.focus();
  };

  const insertAround = (before, after, placeholder) => {
    focusBody();
    const start = bodyEl.selectionStart;
    const end = bodyEl.selectionEnd;
    const selected = bodyEl.value.slice(start, end) || placeholder;
    bodyEl.setRangeText(`${before}${selected}${after}`, start, end, 'select');
    bodyEl.dispatchEvent(new Event('input', { bubbles: true }));
    if (start === end) {
      bodyEl.setSelectionRange(start + before.length, start + before.length + selected.length);
    }
  };

  const prefixLines = (prefix) => {
    focusBody();
    const start = bodyEl.value.lastIndexOf('\n', bodyEl.selectionStart - 1) + 1;
    bodyEl.setRangeText(prefix, start, start, 'end');
    bodyEl.dispatchEvent(new Event('input', { bubbles: true }));
  };

  qsa('[data-md]').forEach((button) => {
    button.addEventListener('click', () => {
      const action = button.dataset.md;
      if (action === 'h2') prefixLines('## ');
      else if (action === 'bold') insertAround('**', '**', '加粗文字');
      else if (action === 'italic') insertAround('*', '*', '斜体文字');
      else if (action === 'quote') prefixLines('> ');
      else if (action === 'code') insertAround('`', '`', 'code');
      else if (action === 'link') insertAround('[', '](https://)', '链接文字');
      else if (action === 'hr') insertAround('\n\n---\n\n', '', '');
      else if (action === 'image') {
        const input = qs('#inline-image-input');
        input.value = '';
        input.click();
      }
    });
  });

  const uploadFile = async (file) => {
    const form = new FormData();
    form.append('file', file);
    const result = await api('/api/admin/upload', { method: 'POST', body: form });
    return result.url;
  };

  qs('#inline-image-input')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const button = qs('[data-md="image"]');
    button.disabled = true;
    try {
      const url = await uploadFile(file);
      insertAround(`\n\n![图片](${url})\n\n`, '', '');
      toast('图片已插入正文。', 'ok');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      button.disabled = false;
    }
  });

  qs('#cover-upload')?.addEventListener('click', () => {
    const input = qs('#cover-image-input');
    input.value = '';
    input.click();
  });

  qs('#cover-image-input')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const url = await uploadFile(file);
      coverEl.value = url;
      updateCoverPreview();
      markDirty();
      toast('封面已上传。', 'ok');
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  qs('#cover-clear')?.addEventListener('click', () => {
    coverEl.value = '';
    updateCoverPreview();
    markDirty();
  });

  const savePost = async () => {
    const title = titleEl.value.trim();
    if (!title) {
      toast('请先填写文章标题。', 'error');
      titleEl.focus();
      return;
    }
    const saveButton = qs('#save-post');
    saveButton.disabled = true;
    saveButton.textContent = '保存中…';
    try {
      const payload = {
        title,
        body: bodyEl.value,
        date: dateEl.value,
        draft: draftStatus,
        featured: featuredEl.checked,
        tags: tagsEl.value,
        summary: summaryEl.value,
        cover: coverEl.value.trim(),
      };
      let result;
      if (currentId) {
        payload.newId = slugEl.value.trim() || undefined;
        result = await api(`/api/admin/posts/${encodeURIComponent(currentId)}`, { method: 'PUT', body: payload });
      } else {
        payload.id = slugEl.value.trim() || undefined;
        result = await api('/api/admin/posts', { method: 'POST', body: payload });
      }
      const saved = result.post;
      currentId = saved.id;
      state.editorPost = saved;
      state.editorDirty = false;
      const nextHash = `#/editor/${saved.id}`;
      if (location.hash !== nextHash) {
        history.replaceState(null, '', nextHash);
        state.currentRoute = { name: 'editor', id: saved.id, hash: nextHash };
      }
      slugEl.value = saved.id;
      slugEl.removeAttribute('data-locked');
      qs('#delete-post')?.classList.remove('hidden');
      if (dirtyEl) dirtyEl.textContent = '';
      if (saveStateEl) saveStateEl.textContent = `已保存 ${fmtDateTime(new Date())}`;
      if (qs('#editor-preview-state')) qs('#editor-preview-state').textContent = '预览正在后台重建，约 1 秒后刷新。';
      updateLinks(saved);
      toast('文章已保存，预览正在重建。', 'ok');
      refreshChrome();
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      saveButton.disabled = false;
      saveButton.innerHTML = `${icon('check')} 保存更改`;
    }
  };

  qs('#save-post')?.addEventListener('click', savePost);

  qs('#open-preview')?.addEventListener('click', () => {
    if (!currentId) {
      toast('请先保存文章，再打开页面预览。', 'warn');
      return;
    }
    const base = (state.user?.urls?.preview || '/preview/').replace(/\/?$/, '/');
    window.open(`${base}posts/${encodeURIComponent(currentId)}/`, '_blank', 'noopener');
  });

  qs('#delete-post')?.addEventListener('click', async () => {
    if (!currentId) return;
    const ok = await confirmDialog({
      title: '删除这篇文章？',
      message: `「${titleEl.value || currentId}」将被移入服务器回收目录。此操作需要重新发布才会从线上消失。`,
      confirmLabel: '移至回收站',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/admin/posts/${encodeURIComponent(currentId)}`, { method: 'DELETE' });
      state.editorDirty = false;
      toast('文章已移入回收目录。', 'ok');
      location.hash = '#/posts';
      refreshChrome();
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  const onEditorKeydown = (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      if (state.currentRoute?.name !== 'editor') return;
      event.preventDefault();
      savePost();
    }
  };
  document.addEventListener('keydown', onEditorKeydown);
  state.viewCleanup = () => document.removeEventListener('keydown', onEditorKeydown);

  updateCounts();
  updateCoverPreview();
}

/* ---------- comments ---------- */

async function viewComments() {
  setTopbar('CONTENT / MODERATION', '评论审核');
  const data = await api('/api/admin/comments?status=all');
  const filters = { status: 'pending', post: '', search: '' };
  const selected = new Set();
  const viewEl = qs('#view');
  viewEl.innerHTML = `
    <div class="view-inner view-enter">
      <header class="page-head">
        <div class="page-head-copy">
          <span class="eyebrow">TRANSMISSION LOG / ${data.counts.all} COMMENTS</span>
          <h2>评论审核</h2>
          <p>评论默认进入待审核状态。通过后才会出现在公开文章的下方，隐藏与垃圾标记不会删除数据。</p>
        </div>
        <div class="page-actions">
          <button class="btn btn-ghost" type="button" data-refresh-comments>${icon('refresh')} 刷新</button>
        </div>
      </header>
      <div class="toolbar">
        <div class="tabs" id="comment-tabs">
          <button class="tab" type="button" data-cstatus="all">全部 <span>${data.counts.all}</span></button>
          <button class="tab is-active" type="button" data-cstatus="pending">待审核 <span>${data.counts.pending}</span></button>
          <button class="tab" type="button" data-cstatus="approved">已显示 <span>${data.counts.approved}</span></button>
          <button class="tab" type="button" data-cstatus="hidden">已隐藏 <span>${data.counts.hidden}</span></button>
          <button class="tab" type="button" data-cstatus="spam">垃圾 <span>${data.counts.spam}</span></button>
        </div>
        <div class="comment-toolbar-right">
          <select class="select post-filter" id="comment-post-filter"><option value="">全部文章</option></select>
          <label class="search-field">
            ${icon('search')}
            <input class="input" type="search" placeholder="搜索作者或内容…" data-comment-search>
          </label>
        </div>
      </div>
      <div class="comments-list" id="comments-list"></div>
      <div id="bulk-root"></div>
    </div>`;

  let comments = data.comments;
  let counts = data.counts;
  let commentList = comments;

  const postFilter = qs('#comment-post-filter');
  const posts = new Map();
  comments.forEach((comment) => {
    posts.set(comment.post, comment.post_title || comment.post);
  });
  [...posts.entries()].sort((a, b) => a[1].localeCompare(b[1], 'zh-CN')).forEach(([post, title]) => {
    const option = document.createElement('option');
    option.value = post;
    option.textContent = title;
    postFilter.appendChild(option);
  });

  const syncSelected = () => {
    qsa('.comment-select', qs('#comments-list')).forEach((checkbox) => {
      checkbox.checked = selected.has(checkbox.dataset.selectComment);
    });
    renderBulk();
  };

  const renderBulk = () => {
    const root = qs('#bulk-root');
    if (!root) return;
    if (!selected.size) {
      root.innerHTML = '';
      return;
    }
    root.innerHTML = `
      <div class="bulk-bar">
        <span class="bulk-count">已选择 ${selected.size} 条评论</span>
        <button class="btn btn-sm btn-solid" type="button" data-bulk="approved">${icon('check')} 通过</button>
        <button class="btn btn-sm btn-ghost" type="button" data-bulk="hidden">隐藏</button>
        <button class="btn btn-sm btn-ghost" type="button" data-bulk="spam">标记垃圾</button>
        <button class="btn btn-sm btn-danger" type="button" data-bulk="delete">删除</button>
        <button class="btn-link" type="button" data-bulk-clear>取消选择</button>
      </div>`;
  };

  const statusLabel = (status) => ({
    pending: '待审核',
    approved: '已显示',
    hidden: '已隐藏',
    spam: '垃圾',
  }[status] || status);

  const renderCards = () => {
    const list = qs('#comments-list');
    const query = filters.search.trim().toLowerCase();
    commentList = comments.filter((comment) => {
      if (filters.status !== 'all' && comment.status !== filters.status) return false;
      if (filters.post && comment.post !== filters.post) return false;
      if (!query) return true;
      return `${comment.author} ${comment.content} ${comment.email} ${comment.post_title}`.toLowerCase().includes(query);
    });

    if (!commentList.length) {
      list.innerHTML = `<div class="empty"><strong>这里没有评论</strong><p>换一个筛选条件，或等待新的信号抵达。</p></div>`;
      renderBulk();
      return;
    }

    list.innerHTML = commentList.map((comment) => {
      const actions = [];
      if (comment.status !== 'approved') actions.push(`<button class="btn btn-sm btn-solid" type="button" data-comment-action="approved" data-id="${esc(comment.id)}">${icon('check')} 通过</button>`);
      if (comment.status === 'approved') actions.push(`<button class="btn btn-sm btn-ghost" type="button" data-comment-action="hidden" data-id="${esc(comment.id)}">隐藏</button>`);
      if (comment.status !== 'spam') actions.push(`<button class="btn btn-sm btn-ghost" type="button" data-comment-action="spam" data-id="${esc(comment.id)}">垃圾</button>`);
      actions.push(`<button class="btn btn-sm btn-danger" type="button" data-comment-delete="${esc(comment.id)}">删除</button>`);
      return `
        <article class="comment-card is-${esc(comment.status)}">
          <input class="comment-select" type="checkbox" data-select-comment="${esc(comment.id)}" ${selected.has(comment.id) ? 'checked' : ''} aria-label="选择评论">
          <div class="comment-main">
            <div class="comment-head">
              <span class="comment-author">${esc(comment.author)}</span>
              <span class="badge ${comment.status === 'approved' ? 'is-ok' : comment.status === 'pending' ? 'is-draft' : comment.status === 'spam' ? 'is-danger' : 'is-plain'}">${statusLabel(comment.status)}</span>
              ${comment.email ? `<span class="comment-email">${esc(comment.email)}</span>` : ''}
              <span class="comment-time">${fmtDateTime(comment.created_at)} · ${esc(comment.relative || timeAgo(comment.created_at))}</span>
              <span class="comment-post">${esc(comment.post_title || comment.post)}</span>
            </div>
            <p class="comment-body">${esc(comment.content)}</p>
            ${comment.website ? `<a class="comment-link" href="${esc(comment.website)}" target="_blank" rel="nofollow noopener noreferrer">${esc(comment.website)} ↗</a>` : ''}
          </div>
          <div class="comment-actions">${actions.join('')}</div>
        </article>`;
    }).join('');

    syncSelected();
  };

  const reload = async () => {
    const next = await api('/api/admin/comments?status=all');
    comments = next.comments;
    counts = next.counts;
    qsa('[data-cstatus]').forEach((tab) => {
      const key = tab.dataset.cstatus;
      const value = tab.querySelector('span');
      if (value) value.textContent = counts[key] ?? 0;
    });
    renderCards();
    refreshChrome();
  };

  qsa('[data-cstatus]').forEach((tab) => {
    tab.addEventListener('click', () => {
      filters.status = tab.dataset.cstatus;
      qsa('[data-cstatus]').forEach((item) => item.classList.toggle('is-active', item === tab));
      renderCards();
    });
  });

  postFilter.addEventListener('change', () => {
    filters.post = postFilter.value;
    renderCards();
  });

  qs('[data-comment-search]')?.addEventListener('input', (event) => {
    filters.search = event.target.value;
    renderCards();
  });

  qs('[data-refresh-comments]')?.addEventListener('click', async () => {
    await reload();
    toast('评论列表已刷新。', 'ok');
  });

  qs('#comments-list')?.addEventListener('change', (event) => {
    const checkbox = event.target.closest('[data-select-comment]');
    if (!checkbox) return;
    if (checkbox.checked) selected.add(checkbox.dataset.selectComment);
    else selected.delete(checkbox.dataset.selectComment);
    renderBulk();
  });

  qs('#comments-list')?.addEventListener('click', async (event) => {
    const actionButton = event.target.closest('[data-comment-action]');
    if (actionButton) {
      actionButton.disabled = true;
      try {
        await api(`/api/admin/comments/${encodeURIComponent(actionButton.dataset.id)}`, {
          method: 'PATCH',
          body: { status: actionButton.dataset.commentAction },
        });
        toast(`评论已${statusLabel(actionButton.dataset.commentAction)}。`, 'ok');
        selected.delete(actionButton.dataset.id);
        await reload();
      } catch (error) {
        toast(error.message, 'error');
        actionButton.disabled = false;
      }
      return;
    }
    const deleteButton = event.target.closest('[data-comment-delete]');
    if (deleteButton) {
      const comment = comments.find((item) => item.id === deleteButton.dataset.commentDelete);
      const ok = await confirmDialog({
        title: '永久删除这条评论？',
        message: `来自「${comment?.author || '匿名'}」的评论将被永久移除，无法恢复。`,
        confirmLabel: '删除',
        danger: true,
      });
      if (!ok) return;
      try {
        await api(`/api/admin/comments/${encodeURIComponent(deleteButton.dataset.commentDelete)}`, { method: 'DELETE' });
        toast('评论已删除。', 'ok');
        selected.delete(deleteButton.dataset.commentDelete);
        await reload();
      } catch (error) {
        toast(error.message, 'error');
      }
    }
  });

  qs('#bulk-root')?.addEventListener('click', async (event) => {
    if (event.target.closest('[data-bulk-clear]')) {
      selected.clear();
      syncSelected();
      renderBulk();
      return;
    }
    const button = event.target.closest('[data-bulk]');
    if (!button) return;
    const action = button.dataset.bulk;
    const ids = [...selected];
    if (!ids.length) return;
    if (action === 'delete') {
      const ok = await confirmDialog({
        title: `删除 ${ids.length} 条评论？`,
        message: '删除后无法恢复。',
        confirmLabel: '删除',
        danger: true,
      });
      if (!ok) return;
      try {
        await Promise.all(ids.map((id) => api(`/api/admin/comments/${encodeURIComponent(id)}`, { method: 'DELETE' })));
        toast(`已删除 ${ids.length} 条评论。`, 'ok');
        selected.clear();
        await reload();
      } catch (error) {
        toast(error.message, 'error');
      }
      return;
    }
    try {
      await api('/api/admin/comments/bulk', { method: 'POST', body: { ids, status: action } });
      toast(`已处理 ${ids.length} 条评论。`, 'ok');
      selected.clear();
      await reload();
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  renderCards();
}

/* ---------- content form helpers ---------- */

function setPathValue(target, path, value) {
  const keys = path.split('.');
  let cursor = target;
  keys.forEach((key, index) => {
    if (index === keys.length - 1) {
      cursor[key] = value;
      return;
    }
    if (!cursor[key] || typeof cursor[key] !== 'object') {
      cursor[key] = /^\d+$/.test(keys[index + 1]) ? [] : {};
    }
    cursor = cursor[key];
  });
}

function mergeDeep(base, patch) {
  if (Array.isArray(patch)) return patch.map((item) => (item && typeof item === 'object' ? mergeDeep({}, item) : item));
  if (!patch || typeof patch !== 'object') return patch;
  const next = base && typeof base === 'object' && !Array.isArray(base) ? { ...base } : {};
  Object.entries(patch).forEach(([key, value]) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      next[key] = mergeDeep(next[key], value);
    } else {
      next[key] = value;
    }
  });
  return next;
}

function formInput({ label, path, value = '', type = 'text', rows = 0, placeholder = '', hint = '', full = false }) {
  const className = rows > 0 ? 'textarea' : 'input';
  const control = rows > 0
    ? `<textarea class="${className}" rows="${rows}" data-path="${esc(path)}" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
    : `<input class="${className}" type="${esc(type)}" data-path="${esc(path)}" value="${esc(value)}" placeholder="${esc(placeholder)}">`;
  return `<label class="field${full ? ' field-full' : ''}"><span class="field-label">${label}</span>${control}${hint ? `<span class="field-hint">${hint}</span>` : ''}</label>`;
}

function formCheckbox({ path, checked, text, hint = '' }) {
  return `<div class="field">
    <label class="checkbox"><input type="checkbox" data-path="${esc(path)}" data-type="bool"${checked ? ' checked' : ''}> ${text}</label>
    ${hint ? `<span class="field-hint">${hint}</span>` : ''}
  </div>`;
}

function keyInput(key, value = '', { label = '', placeholder = '', rows = 0, full = false, hint = '' } = {}) {
  const className = rows > 0 ? 'textarea' : 'input';
  const control = rows > 0
    ? `<textarea class="${className}" rows="${rows}" data-key="${esc(key)}" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
    : `<input class="${className}" type="text" data-key="${esc(key)}" value="${esc(value)}" placeholder="${esc(placeholder)}">`;
  return `<label class="field${full ? ' field-full' : ''}">${label ? `<span class="field-label">${label}</span>` : ''}${control}${hint ? `<span class="field-hint">${hint}</span>` : ''}</label>`;
}

function readFormPaths(root) {
  const model = {};
  qsa('[data-path]', root).forEach((input) => {
    const path = input.dataset.path;
    if (!path) return;
    const value = input.dataset.type === 'bool' ? input.checked : input.value;
    setPathValue(model, path, value);
  });
  return model;
}

function repeatItemHtml(name, index, body) {
  return `<div class="repeat-item" data-repeat-item data-repeat-name="${esc(name)}">
    <div class="repeat-head">
      <span class="repeat-index">${esc(name.toUpperCase())} / ${String(index + 1).padStart(2, '0')}</span>
      <button class="repeat-remove" type="button" data-remove-repeat="${esc(name)}" data-index="${index}">REMOVE</button>
    </div>
    ${body}
  </div>`;
}

function repeatBlock(name, items, render, addLabel) {
  return `<div class="repeat-list" data-repeat="${esc(name)}">${items.map((item, index) => repeatItemHtml(name, index, render(item, index))).join('')}</div>
    <button class="add-row" type="button" data-add-repeat="${esc(name)}">${icon('plus')} ${addLabel}</button>`;
}

function readRepeatItems(name, root = document) {
  const host = qs(`[data-repeat="${name}"]`, root);
  if (!host) return [];
  return qsa('[data-repeat-item]', host).map((item) => {
    const data = {};
    qsa('[data-key]', item).forEach((input) => {
      data[input.dataset.key] = input.value;
    });
    return data;
  });
}

function wireRepeatEditor(root, definitions) {
  const render = (name, list) => {
    const host = qs(`[data-repeat="${name}"]`, root);
    const definition = definitions[name];
    if (!host || !definition) return;
    host.innerHTML = list.map((item, index) => repeatItemHtml(name, index, definition.render(item, index))).join('');
  };

  root.addEventListener('click', (event) => {
    const addButton = event.target.closest('[data-add-repeat]');
    if (addButton) {
      const name = addButton.dataset.addRepeat;
      const definition = definitions[name];
      if (!definition) return;
      const list = readRepeatItems(name, root);
      list.push(definition.empty());
      render(name, list);
      const host = qs(`[data-repeat="${name}"]`, root);
      qs('input, textarea', host?.lastElementChild)?.focus();
      return;
    }
    const removeButton = event.target.closest('[data-remove-repeat]');
    if (!removeButton) return;
    const name = removeButton.dataset.removeRepeat;
    const index = Number(removeButton.dataset.index);
    const list = readRepeatItems(name, root);
    if (Number.isInteger(index)) list.splice(index, 1);
    render(name, list);
  });

  return { render };
}

function splitList(value) {
  return String(value || '')
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitLines(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/* ---------- site settings ---------- */

async function viewSite() {
  setTopbar('PAGES / IDENTITY', '站点设置');
  const data = await api('/api/admin/site');
  let site = data.site || {};
  const socials = Array.isArray(site.socials) ? site.socials : [];
  const hero = site.hero || {};
  const primaryCta = hero.primaryCta || {};
  const secondaryCta = hero.secondaryCta || {};
  const home = site.home || {};
  const pages = site.pages || {};
  const author = site.author || {};
  const publicSite = state.user?.urls?.site || SITE_URL;

  const viewEl = qs('#view');
  viewEl.innerHTML = `
    <div class="view-inner view-enter">
      <header class="page-head">
        <div class="page-head-copy">
          <span class="eyebrow">PAGES / SITE IDENTITY</span>
          <h2>站点设置</h2>
          <p>编辑博客的名称、首页文案、联系方式与页面标题。保存后预览会自动重建，确认无误后再一键发布。</p>
        </div>
        <div class="page-actions">
          <a class="btn btn-ghost" href="${esc(publicSite)}" target="_blank" rel="noopener noreferrer">${icon('external')} 打开博客</a>
        </div>
      </header>

      <form class="form-stack" id="site-form" novalidate>
        <section class="form-section">
          <div class="form-section-head">
            <div><h3>站点身份</h3><p>出现在浏览器标题、页脚与搜索摘要中的基础信息。</p></div>
            <span class="mono muted">IDENTITY</span>
          </div>
          <div class="form-section-body">
            <div class="field-grid">
              ${formInput({ label: '站点名称', path: 'title', value: site.title || '', placeholder: 'AI 革命' })}
              ${formInput({ label: '英文名称', path: 'titleEn', value: site.titleEn || '', placeholder: 'THE INTELLIGENCE REVOLUTION' })}
            </div>
            ${formInput({ label: '站点描述', path: 'description', value: site.description || '', rows: 3, full: true, hint: '用于首页与搜索引擎摘要。' })}
            <div class="field-grid">
              ${formInput({ label: '关键词', path: 'keywords', value: (site.keywords || []).join(', '), hint: '用逗号分隔。' })}
              ${formInput({ label: 'ICP 备案号', path: 'icp', value: site.icp || '', placeholder: '留空则不显示' })}
            </div>
            ${formInput({ label: '页脚短句', path: 'footerNote', value: site.footerNote || '', hint: '显示在页脚「保持观测」下方。' })}
          </div>
        </section>

        <section class="form-section">
          <div class="form-section-head">
            <div><h3>作者与联系方式</h3><p>这些信息会显示在首页、文章页与简历的显眼位置。</p></div>
            <span class="mono muted">AUTHOR</span>
          </div>
          <div class="form-section-body">
            <div class="field-grid">
              ${formInput({ label: '作者名称', path: 'author.name', value: author.name || '' })}
              ${formInput({ label: '英文名', path: 'author.nameEn', value: author.nameEn || '' })}
            </div>
            <div class="field-grid">
              ${formInput({ label: '身份 / 角色', path: 'author.role', value: author.role || '', placeholder: '音频软件工程师 · AI 语音' })}
              ${formInput({ label: '头像地址', path: 'author.avatar', value: author.avatar || '', placeholder: '/images/avatar.svg' })}
            </div>
            ${formInput({ label: '作者简介', path: 'author.bio', value: author.bio || '', rows: 3, full: true })}
            <div class="field-grid">
              ${formInput({ label: '所在地', path: 'location', value: site.location || '', placeholder: '杭州 · 中国' })}
              ${formInput({ label: '邮箱', path: 'email', type: 'email', value: site.email || '', placeholder: 'name@example.com' })}
            </div>
            ${formInput({ label: 'GitHub', path: 'github', value: site.github || '', type: 'url', full: true, placeholder: 'https://github.com/username' })}
            <div>
              <div class="field-label" style="margin-bottom:10px">社交链接</div>
              ${repeatBlock('socials', socials, (social) => `
                <div class="field-grid cols-3">
                  ${keyInput('label', social.label || '', { label: '名称', placeholder: 'GitHub' })}
                  ${keyInput('type', social.type || '', { label: '类型', placeholder: 'github / email / rss' })}
                  ${keyInput('handle', social.handle || '', { label: 'Handle', placeholder: '@username' })}
                  ${keyInput('url', social.url || '', { label: '链接', placeholder: 'https://… 或 /path', full: true })}
                </div>`, '添加社交链接')}
            </div>
          </div>
        </section>

        <section class="form-section">
          <div class="form-section-head">
            <div><h3>首页 Hero</h3><p>首页第一屏的标题、说明与两个行动按钮。</p></div>
            <span class="mono muted">HERO</span>
          </div>
          <div class="form-section-body">
            <div class="field-grid cols-3">
              ${formInput({ label: '标签行', path: 'hero.eyebrow', value: hero.eyebrow || '' })}
              ${formInput({ label: '期号', path: 'hero.issue', value: hero.issue || '', placeholder: 'ISSUE 001' })}
              ${formInput({ label: '滚动关键词', path: 'hero.marquee', value: hero.marquee || '', placeholder: 'MODEL / AGENT / VOICE' })}
            </div>
            <div class="field-grid">
              ${formInput({ label: '主标题', path: 'hero.title', value: hero.title || '' })}
              ${formInput({ label: '英文标题', path: 'hero.titleEn', value: hero.titleEn || '' })}
            </div>
            ${formInput({ label: 'Hero 描述', path: 'hero.description', value: hero.description || '', rows: 3, full: true })}
            <div class="field-grid">
              ${formInput({ label: '主按钮文案', path: 'hero.primaryCta.label', value: primaryCta.label || '' })}
              ${formInput({ label: '主按钮链接', path: 'hero.primaryCta.url', value: primaryCta.url || '', placeholder: '/posts/' })}
              ${formInput({ label: '次按钮文案', path: 'hero.secondaryCta.label', value: secondaryCta.label || '' })}
              ${formInput({ label: '次按钮链接', path: 'hero.secondaryCta.url', value: secondaryCta.url || '', placeholder: '/resume/' })}
            </div>
          </div>
        </section>

        <section class="form-section">
          <div class="form-section-head">
            <div><h3>首页模块文案</h3><p>精选区、最新文章、主题与作者卡片的标题和说明。</p></div>
            <span class="mono muted">HOME</span>
          </div>
          <div class="form-section-body">
            <div class="field-grid">
              ${formInput({ label: '精选标签', path: 'home.featuredLabel', value: home.featuredLabel || '' })}
              ${formInput({ label: '最新文章标题', path: 'home.latestTitle', value: home.latestTitle || '' })}
            </div>
            ${formInput({ label: '最新文章说明', path: 'home.latestDescription', value: home.latestDescription || '', rows: 2, full: true })}
            <div class="field-grid">
              ${formInput({ label: '主题区标题', path: 'home.topicsTitle', value: home.topicsTitle || '' })}
              ${formInput({ label: '作者区标题', path: 'home.aboutTitle', value: home.aboutTitle || '' })}
            </div>
            ${formInput({ label: '作者区文案', path: 'home.aboutText', value: home.aboutText || '', rows: 3, full: true })}
          </div>
        </section>

        <section class="form-section">
          <div class="form-section-head">
            <div><h3>页面标题与说明</h3><p>文章列表、档案、标签与检索页的页头文案。</p></div>
            <span class="mono muted">PAGES</span>
          </div>
          <div class="form-section-body">
            <div class="field-grid">
              ${formInput({ label: '文章页标题', path: 'pages.postsTitle', value: pages.postsTitle || '' })}
              ${formInput({ label: '档案页标题', path: 'pages.archivesTitle', value: pages.archivesTitle || '' })}
              ${formInput({ label: '标签页标题', path: 'pages.tagsTitle', value: pages.tagsTitle || '' })}
              ${formInput({ label: '检索页标题', path: 'pages.searchTitle', value: pages.searchTitle || '' })}
            </div>
            ${formInput({ label: '文章页说明', path: 'pages.postsDescription', value: pages.postsDescription || '', rows: 2, full: true })}
            ${formInput({ label: '档案页说明', path: 'pages.archivesDescription', value: pages.archivesDescription || '', rows: 2, full: true })}
            ${formInput({ label: '标签页说明', path: 'pages.tagsDescription', value: pages.tagsDescription || '', rows: 2, full: true })}
            ${formInput({ label: '检索页说明', path: 'pages.searchDescription', value: pages.searchDescription || '', rows: 2, full: true })}
          </div>
        </section>

        <section class="form-section">
          <div class="form-section-head">
            <div><h3>评论服务</h3><p>公开博客通过这个接口读取与提交评论。</p></div>
            <span class="mono muted">COMMENTS</span>
          </div>
          <div class="form-section-body">
            ${formCheckbox({ path: 'commentsEnabled', checked: Boolean(site.commentsEnabled), text: '在公开博客启用评论', hint: '关闭后文章页不再渲染评论区，后台数据会保留。' })}
            ${formInput({ label: '评论接口地址', path: 'commentApiBase', value: site.commentApiBase || '', type: 'url', full: true, placeholder: 'https://your-admin-domain', hint: '通常是控制台的公网地址，不需要带 /api 路径。' })}
          </div>
        </section>

        <div class="form-actions">
          <span class="form-status" id="site-form-status">所有修改保存后会自动重建预览。</span>
          <button class="btn btn-ghost" type="button" data-reset-site>重置修改</button>
          <button class="btn btn-solid" type="submit" id="save-site">${icon('check')} 保存站点设置</button>
        </div>
      </form>
    </div>`;

  const form = qs('#site-form');
  wireRepeatEditor(form, {
    socials: {
      empty: () => ({ label: '', type: '', url: '', handle: '' }),
      render: (social) => `
        <div class="field-grid cols-3">
          ${keyInput('label', social.label || '', { label: '名称', placeholder: 'GitHub' })}
          ${keyInput('type', social.type || '', { label: '类型', placeholder: 'github / email / rss' })}
          ${keyInput('handle', social.handle || '', { label: 'Handle', placeholder: '@username' })}
          ${keyInput('url', social.url || '', { label: '链接', placeholder: 'https://… 或 /path', full: true })}
        </div>`,
    },
  });

  const statusEl = qs('#site-form-status');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = qs('#save-site');
    button.disabled = true;
    button.textContent = '保存中…';
    try {
      const model = readFormPaths(form);
      const payload = mergeDeep(site, model);
      payload.keywords = splitList(model.keywords);
      payload.socials = readRepeatItems('socials', form)
        .map((social) => ({
          label: social.label.trim(),
          type: social.type.trim(),
          url: social.url.trim(),
          handle: social.handle.trim(),
        }))
        .filter((social) => social.label || social.url || social.handle);
      const result = await api('/api/admin/site', { method: 'PUT', body: payload });
      site = result.site;
      if (statusEl) statusEl.textContent = `已保存 ${fmtDateTime(new Date())} · 预览正在重建`;
      toast('站点设置已保存，预览正在重建。', 'ok');
      refreshChrome();
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      button.disabled = false;
      button.innerHTML = `${icon('check')} 保存站点设置`;
    }
  });

  qs('[data-reset-site]')?.addEventListener('click', () => {
    const ok = window.confirm('放弃当前未保存的站点修改，重新载入服务器数据？');
    if (ok) viewSite();
  });
}

/* ---------- resume ---------- */

async function viewResume() {
  setTopbar('PAGES / RESUME', '简历');
  const data = await api('/api/admin/resume');
  let resume = data.resume || {};
  const highlights = Array.isArray(resume.highlights) ? resume.highlights : [];
  const experience = Array.isArray(resume.experience) ? resume.experience : [];
  const education = Array.isArray(resume.education) ? resume.education : [];
  const skills = Array.isArray(resume.skills) ? resume.skills : [];
  const languages = Array.isArray(resume.languages) ? resume.languages : [];
  const now = Array.isArray(resume.now) ? resume.now : [];
  const publicSite = state.user?.urls?.site || SITE_URL;

  const experienceFields = (item) => `
    <div class="field-grid">
      ${keyInput('period', item.period || '', { label: '时间', placeholder: '现在 / 2021 — 2024' })}
      ${keyInput('company', item.company || '', { label: '公司 / 项目', placeholder: 'ZOOM' })}
      ${keyInput('role', item.role || '', { label: '职位', placeholder: '底层音频工程师' })}
      ${keyInput('location', item.location || '', { label: '地点', placeholder: '杭州' })}
    </div>
    ${keyInput('points', (item.points || []).join('\n'), { label: '经历描述', rows: 4, full: true, placeholder: '每行一条', hint: '每行会生成一个要点。' })}`;

  const viewEl = qs('#view');
  viewEl.innerHTML = `
    <div class="view-inner view-enter">
      <header class="page-head">
        <div class="page-head-copy">
          <span class="eyebrow">PAGES / RESUME</span>
          <h2>个人简历</h2>
          <p>维护公开简历页的基本信息、工作经历、能力矩阵与「正在关注」。保存后会自动重建预览。</p>
        </div>
        <div class="page-actions">
          <a class="btn btn-ghost" href="${esc(publicSite)}resume/" target="_blank" rel="noopener noreferrer">${icon('external')} 查看简历页</a>
        </div>
      </header>

      <form class="form-stack" id="resume-form" novalidate>
        <section class="form-section">
          <div class="form-section-head">
            <div><h3>基本信息</h3><p>姓名、定位与一句话介绍。</p></div>
            <span class="mono muted">IDENTITY</span>
          </div>
          <div class="form-section-body">
            <div class="field-grid">
              ${formInput({ label: '姓名', path: 'name', value: resume.name || '' })}
              ${formInput({ label: '英文名', path: 'nameEn', value: resume.nameEn || '' })}
            </div>
            ${formInput({ label: '职业标题', path: 'title', value: resume.title || '', full: true, placeholder: '音频软件工程师 · AI 语音系统' })}
            <div class="field-grid">
              ${formInput({ label: '所在地', path: 'location', value: resume.location || '' })}
              ${formInput({ label: '当前状态', path: 'status', value: resume.status || '', placeholder: '开放技术交流与合作' })}
              ${formInput({ label: '邮箱', path: 'email', type: 'email', value: resume.email || '' })}
              ${formInput({ label: 'GitHub', path: 'github', type: 'url', value: resume.github || '' })}
            </div>
            ${formInput({ label: '个人网站', path: 'website', type: 'url', value: resume.website || '', full: true, placeholder: '留空则不显示' })}
            ${formInput({ label: '个人简介', path: 'summary', value: resume.summary || '', rows: 4, full: true })}
          </div>
        </section>

        <section class="form-section">
          <div class="form-section-head">
            <div><h3>数据亮点</h3><p>简历页头部的三个关键数字。</p></div>
            <span class="mono muted">HIGHLIGHTS</span>
          </div>
          <div class="form-section-body">
            ${repeatBlock('highlights', highlights, (item) => `
              <div class="field-grid">
                ${keyInput('value', item.value || '', { label: '数值', placeholder: '10+' })}
                ${keyInput('label', item.label || '', { label: '说明', placeholder: '年实时音频研发' })}
              </div>`, '添加数据亮点')}
          </div>
        </section>

        <section class="form-section">
          <div class="form-section-head">
            <div><h3>工作经历</h3><p>从当前到早期，按你希望的顺序排列。</p></div>
            <span class="mono muted">EXPERIENCE</span>
          </div>
          <div class="form-section-body">
            ${repeatBlock('experience', experience, experienceFields, '添加工作经历')}
          </div>
        </section>

        <section class="form-section">
          <div class="form-section-head">
            <div><h3>教育经历</h3><p>没有可填写的内容时，可以全部移除。</p></div>
            <span class="mono muted">EDUCATION</span>
          </div>
          <div class="form-section-body">
            ${repeatBlock('education', education, (item) => `
              <div class="field-grid cols-3">
                ${keyInput('period', item.period || '', { label: '时间', placeholder: '2010 — 2014' })}
                ${keyInput('school', item.school || '', { label: '学校', placeholder: '学校名称' })}
                ${keyInput('detail', item.detail || '', { label: '专业 / 说明', placeholder: '专业或方向' })}
              </div>`, '添加教育经历')}
          </div>
        </section>

        <section class="form-section">
          <div class="form-section-head">
            <div><h3>能力矩阵</h3><p>按组展示的技术能力，用逗号分隔组内标签。</p></div>
            <span class="mono muted">SKILLS</span>
          </div>
          <div class="form-section-body">
            ${repeatBlock('skills', skills, (item) => `
              <div class="field-grid">
                ${keyInput('group', item.group || '', { label: '分组', placeholder: '实时音频' })}
                ${keyInput('items', (item.items || []).join(', '), { label: '标签', placeholder: 'WebRTC, Opus, 抖动缓冲' })}
              </div>`, '添加能力分组')}
          </div>
        </section>

        <section class="form-section">
          <div class="form-section-head">
            <div><h3>语言与其他</h3><p>语言能力与当前关注方向。</p></div>
            <span class="mono muted">MORE</span>
          </div>
          <div class="form-section-body">
            ${repeatBlock('languages', languages, (item) => `
              <div class="field-grid">
                ${keyInput('name', item.name || '', { label: '语言', placeholder: '中文' })}
                ${keyInput('level', item.level || '', { label: '程度', placeholder: '母语 / 工作语言' })}
              </div>`, '添加语言')}
            <label class="field field-full">
              <span class="field-label">正在关注</span>
              <textarea class="textarea" rows="4" id="resume-now" placeholder="每行一条">${esc(now.join('\n'))}</textarea>
              <span class="field-hint">每行一条，显示在简历页的 NOW 区域。</span>
            </label>
          </div>
        </section>

        <div class="form-actions">
          <span class="form-status" id="resume-form-status">保存后自动重建预览。</span>
          <button class="btn btn-ghost" type="button" data-reset-resume>重置修改</button>
          <button class="btn btn-solid" type="submit" id="save-resume">${icon('check')} 保存简历</button>
        </div>
      </form>
    </div>`;

  const form = qs('#resume-form');
  wireRepeatEditor(form, {
    highlights: {
      empty: () => ({ value: '', label: '' }),
      render: (item) => `
        <div class="field-grid">
          ${keyInput('value', item.value || '', { label: '数值', placeholder: '10+' })}
          ${keyInput('label', item.label || '', { label: '说明', placeholder: '年实时音频研发' })}
        </div>`,
    },
    experience: {
      empty: () => ({ period: '', company: '', role: '', location: '', points: '' }),
      render: experienceFields,
    },
    education: {
      empty: () => ({ period: '', school: '', detail: '' }),
      render: (item) => `
        <div class="field-grid cols-3">
          ${keyInput('period', item.period || '', { label: '时间', placeholder: '2010 — 2014' })}
          ${keyInput('school', item.school || '', { label: '学校', placeholder: '学校名称' })}
          ${keyInput('detail', item.detail || '', { label: '专业 / 说明', placeholder: '专业或方向' })}
        </div>`,
    },
    skills: {
      empty: () => ({ group: '', items: '' }),
      render: (item) => `
        <div class="field-grid">
          ${keyInput('group', item.group || '', { label: '分组', placeholder: '实时音频' })}
          ${keyInput('items', (item.items || []).join(', '), { label: '标签', placeholder: 'WebRTC, Opus, 抖动缓冲' })}
        </div>`,
    },
    languages: {
      empty: () => ({ name: '', level: '' }),
      render: (item) => `
        <div class="field-grid">
          ${keyInput('name', item.name || '', { label: '语言', placeholder: '中文' })}
          ${keyInput('level', item.level || '', { label: '程度', placeholder: '母语 / 工作语言' })}
        </div>`,
    },
  });

  const statusEl = qs('#resume-form-status');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = qs('#save-resume');
    button.disabled = true;
    button.textContent = '保存中…';
    try {
      const basics = readFormPaths(form);
      const nextHighlights = readRepeatItems('highlights', form)
        .map((item) => ({ value: item.value.trim(), label: item.label.trim() }))
        .filter((item) => item.value || item.label);
      const nextExperience = readRepeatItems('experience', form)
        .map((item) => ({
          period: item.period.trim(),
          company: item.company.trim(),
          role: item.role.trim(),
          location: item.location.trim(),
          points: splitLines(item.points),
        }))
        .filter((item) => item.company || item.role || item.points.length);
      const nextEducation = readRepeatItems('education', form)
        .map((item) => ({ period: item.period.trim(), school: item.school.trim(), detail: item.detail.trim() }))
        .filter((item) => item.school || item.detail);
      const nextSkills = readRepeatItems('skills', form)
        .map((item) => ({ group: item.group.trim(), items: splitList(item.items) }))
        .filter((item) => item.group || item.items.length);
      const nextLanguages = readRepeatItems('languages', form)
        .map((item) => ({ name: item.name.trim(), level: item.level.trim() }))
        .filter((item) => item.name || item.level);

      const payload = {
        ...resume,
        ...basics,
        highlights: nextHighlights,
        experience: nextExperience,
        education: nextEducation,
        skills: nextSkills,
        languages: nextLanguages,
        now: splitLines(qs('#resume-now')?.value),
      };
      const result = await api('/api/admin/resume', { method: 'PUT', body: payload });
      resume = result.resume;
      if (statusEl) statusEl.textContent = `已保存 ${fmtDateTime(new Date())} · 预览正在重建`;
      toast('简历已保存，预览正在重建。', 'ok');
      refreshChrome();
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      button.disabled = false;
      button.innerHTML = `${icon('check')} 保存简历`;
    }
  });

  qs('[data-reset-resume]')?.addEventListener('click', () => {
    const ok = window.confirm('放弃当前未保存的简历修改，重新载入服务器数据？');
    if (ok) viewResume();
  });
}

/* ---------- tags ---------- */

async function viewTags() {
  setTopbar('PAGES / TOPICS', '标签');
  const data = await api('/api/admin/tags');
  let tags = Array.isArray(data.tags) ? data.tags : [];
  const linked = tags.reduce((sum, tag) => sum + (tag.count || 0), 0);
  const viewEl = qs('#view');

  viewEl.innerHTML = `
    <div class="view-inner view-enter">
      <header class="page-head">
        <div class="page-head-copy">
          <span class="eyebrow">TOPIC INDEX / ${String(tags.length).padStart(2, '0')} TAGS</span>
          <h2>标签</h2>
          <p>标签来自文章。这里维护每个主题的描述，也可以重命名或删除标签；改动会同步到所有相关文章。</p>
        </div>
        <div class="page-actions">
          <a class="btn btn-ghost" href="${(state.user?.urls?.site || SITE_URL).replace(/\/?$/, '/')}tags/" target="_blank" rel="noopener noreferrer">${icon('external')} 查看标签页</a>
        </div>
      </header>

      <div class="tags-panel" id="tags-panel">
        ${tags.length ? tags.map((tag, index) => `
          <div class="tag-row">
            <div class="tag-name">#${esc(tag.name)}<small>${tag.count ? `${tag.count} LINKED OBSERVATIONS` : 'NOT LINKED YET'}</small></div>
            <input class="input" data-tag-desc="${index}" value="${esc(tag.description)}" placeholder="为这个主题写一句描述…">
            <span class="tag-count">${String(tag.count || 0).padStart(2, '0')} POSTS</span>
            <div class="tag-actions">
              <button class="btn btn-sm btn-ghost" type="button" data-tag-rename="${index}">重命名</button>
              <button class="btn btn-sm btn-danger" type="button" data-tag-delete="${index}">删除</button>
            </div>
          </div>`).join('') : `<div class="empty"><strong>还没有标签</strong><p>在文章编辑器中给文章添加标签，它们会自动出现在这里。</p><a class="btn btn-solid" href="#/editor/new">${icon('plus')} 写新文章</a></div>`}
        <div class="tag-add-inline">
          <span class="mono muted">${tags.length} TOPICS · ${linked} LINKED</span>
          <span class="mono muted" style="margin-left:auto">标签由文章自动生成 · 描述在此维护</span>
        </div>
      </div>

      <div class="form-actions" style="margin-top:22px">
        <span class="form-status" id="tags-status">重命名与删除会立即改写文章文件，并重建预览。</span>
        <button class="btn btn-ghost" type="button" data-refresh-tags>${icon('refresh')} 重新载入</button>
        <button class="btn btn-solid" type="button" id="save-tags" ${tags.length ? '' : 'disabled'}>${icon('check')} 保存标签描述</button>
      </div>
    </div>`;

  const statusEl = qs('#tags-status');
  const panel = qs('#tags-panel');

  const readDescriptions = () => Object.fromEntries(tags.map((tag, index) => [
    tag.name,
    { description: qs(`[data-tag-desc="${index}"]`, panel)?.value.trim() || '' },
  ]));

  const persistDescriptions = async () => {
    const result = await api('/api/admin/tags', { method: 'PUT', body: readDescriptions() });
    tags = result.tags;
    return result;
  };

  panel?.addEventListener('input', (event) => {
    if (!event.target.matches('[data-tag-desc]')) return;
    if (statusEl) statusEl.textContent = '有未保存的标签描述修改。';
  });

  qs('#save-tags')?.addEventListener('click', async () => {
    const button = qs('#save-tags');
    button.disabled = true;
    button.textContent = '保存中…';
    try {
      await persistDescriptions();
      if (statusEl) statusEl.textContent = `描述已保存 ${fmtDateTime(new Date())} · 预览正在重建`;
      toast('标签描述已保存。', 'ok');
      refreshChrome();
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      button.disabled = false;
      button.innerHTML = `${icon('check')} 保存标签描述`;
    }
  });

  qs('[data-refresh-tags]')?.addEventListener('click', async () => {
    if (statusEl?.textContent.includes('未保存')) {
      const ok = window.confirm('当前有未保存的标签描述修改，确定重新载入？');
      if (!ok) return;
    }
    await viewTags();
  });

  panel?.addEventListener('click', async (event) => {
    const renameButton = event.target.closest('[data-tag-rename]');
    if (renameButton) {
      const index = Number(renameButton.dataset.tagRename);
      const tag = tags[index];
      if (!tag) return;
      const next = await promptDialog({
        title: '重命名标签',
        label: '新的标签名称',
        value: tag.name,
        placeholder: '最多 20 个字符',
        confirmLabel: '重命名',
        eyebrow: 'RENAME TOPIC',
      });
      if (next === null || !next.trim() || next.trim() === tag.name) return;
      const targetName = next.trim();
      if (targetName.length > 20) {
        toast('标签名不能超过 20 个字符。', 'error');
        return;
      }
      renameButton.disabled = true;
      try {
        await persistDescriptions();
        const result = await api('/api/admin/tags/rename', {
          method: 'POST',
          body: { from: tag.name, to: targetName },
        });
        toast(`已重命名为 #${targetName}，更新 ${result.updated ?? 0} 篇文章。`, 'ok');
        refreshChrome();
        await viewTags();
      } catch (error) {
        toast(error.message, 'error');
        renameButton.disabled = false;
      }
      return;
    }

    const deleteButton = event.target.closest('[data-tag-delete]');
    if (deleteButton) {
      const index = Number(deleteButton.dataset.tagDelete);
      const tag = tags[index];
      if (!tag) return;
      const ok = await confirmDialog({
        title: `删除标签 #${tag.name}？`,
        message: `这个标签会从 ${tag.count || 0} 篇文章中移除，标签描述也会被删除。文章正文不会受到影响，但此操作无法撤销。`,
        confirmLabel: '删除标签',
        danger: true,
      });
      if (!ok) return;
      deleteButton.disabled = true;
      try {
        await persistDescriptions();
        const result = await api('/api/admin/tags/delete', {
          method: 'POST',
          body: { name: tag.name },
        });
        toast(`标签已删除，更新 ${result.updated ?? 0} 篇文章。`, 'ok');
        refreshChrome();
        await viewTags();
      } catch (error) {
        toast(error.message, 'error');
        deleteButton.disabled = false;
      }
    }
  });

  if (!tags.length) {
    qs('#save-tags')?.classList.add('hidden');
  }
}

/* ---------- deploy ---------- */

function actionsMeta(actions) {
  if (!actions || actions.status === 'unavailable') {
    return { label: actions?.message || 'GitHub Actions 状态不可用', dot: 'is-warn' };
  }
  if (actions.status === 'none') {
    return { label: actions.message || '还没有发布记录', dot: '' };
  }
  if (actions.status === 'queued') {
    return { label: '构建已排队，等待运行', dot: 'is-warn' };
  }
  if (actions.status === 'in_progress') {
    return { label: 'GitHub Actions 正在构建', dot: 'is-live' };
  }
  if (actions.status === 'completed') {
    if (actions.conclusion === 'success') return { label: '线上构建成功', dot: 'is-ok' };
    if (actions.conclusion === 'failure') return { label: '线上构建失败', dot: 'is-bad' };
    if (actions.conclusion === 'cancelled') return { label: '构建已取消', dot: 'is-warn' };
    return { label: `构建结束 · ${actions.conclusion || '未知结果'}`, dot: 'is-warn' };
  }
  return { label: `构建状态：${actions.status}`, dot: '' };
}

function historyMeta(status) {
  return {
    success: { label: '已发布', cls: 'is-ok' },
    no_changes: { label: '无改动', cls: 'is-plain' },
    failed: { label: '失败', cls: 'is-danger' },
  }[status] || { label: status || '记录', cls: 'is-plain' };
}

async function viewDeploy() {
  setTopbar('SHIP / PUBLISH', '发布部署');
  const data = await api('/api/admin/deploy/status');
  const git = data.git || {};
  const actions = data.actions || {};
  const preview = data.preview || {};
  const deployState = data.state || {};
  const history = Array.isArray(data.history) ? data.history : [];
  const urls = data.urls || {};
  const meta = actionsMeta(actions);
  const previewMeta = previewLabel(preview);
  const canDeploy = !git.error && !deployState.deploying;
  const pending = git.ahead > 0;
  const changes = Array.isArray(git.changes) ? git.changes : [];
  const viewEl = qs('#view');

  const stepState = (done, active) => (done ? 'is-done' : active ? 'is-active' : '');

  viewEl.innerHTML = `
    <div class="view-inner view-enter">
      <header class="page-head">
        <div class="page-head-copy">
          <span class="eyebrow">SHIP / GITHUB PAGES</span>
          <h2>发布部署</h2>
          <p>把云端的文章与配置提交、推送到 GitHub。推送后由 GitHub Actions 构建静态站点并更新公开博客。</p>
        </div>
        <div class="page-actions">
          <a class="btn btn-ghost" href="${esc(urls.actions || ACTIONS_URL)}" target="_blank" rel="noopener noreferrer">${icon('github')} Actions</a>
          <button class="btn btn-ghost" type="button" data-refresh-deploy>${icon('refresh')} 刷新状态</button>
        </div>
      </header>

      <section class="deploy-hero">
        <div>
          <span class="eyebrow">ONE CLICK SHIP</span>
          <h2>把变化<br>推上<em class="accent">线。</em></h2>
          <p>${git.error ? `Git 状态不可用：${esc(git.error)}` : pending ? `有 ${git.ahead} 个本地提交尚未推送。发布会把它们送到 GitHub，并触发 Pages 构建。` : git.changeCount > 0 ? `工作区有 ${git.changeCount} 个文件改动。发布会自动提交、推送，并触发 Pages 构建。` : '工作区干净。若线上不是最新版本，可以直接发布会同步已有提交。'}</p>
        </div>
        <div class="deploy-actions">
          <button class="btn btn-solid btn-block" type="button" data-deploy ${canDeploy ? '' : 'disabled'}>${icon('upload')} ${deployState.deploying ? '正在发布…' : '一键发布'}</button>
          <button class="btn btn-ghost btn-block" type="button" data-rebuild-preview>${icon('refresh')} 重建预览</button>
          <a class="btn btn-ghost btn-block" href="${esc(urls.site || SITE_URL)}" target="_blank" rel="noopener noreferrer">${icon('external')} 打开公开博客</a>
        </div>
      </section>

      ${deployState.deploying ? `<div class="progress-track" style="margin:-12px 0 24px"><span></span></div>` : ''}

      <div class="deploy-grid">
        <div class="dash-stack">
          <section class="panel">
            <div class="panel-head"><h3>发布流水线</h3><span class="mono muted">${esc(git.branch || 'MAIN')} → GITHUB</span></div>
            <div class="deploy-steps">
              <div class="deploy-step ${stepState(git.changeCount === 0, git.changeCount > 0)}">
                <span class="step-index">01</span>
                <div class="step-copy"><p class="step-title">收集本地改动</p><p class="step-desc">${git.error ? '无法读取 Git 工作区' : git.changeCount ? `${git.changeCount} 个文件等待提交` : '工作区干净，没有未提交文件'}</p></div>
              </div>
              <div class="deploy-step ${stepState(git.changeCount === 0 && !git.error, git.changeCount > 0)}">
                <span class="step-index">02</span>
                <div class="step-copy"><p class="step-title">提交到仓库</p><p class="step-desc">${git.lastCommit ? `${esc(git.lastCommit.short)} · ${esc(git.lastCommit.subject)}` : '尚无提交记录'}</p></div>
              </div>
              <div class="deploy-step ${stepState(!pending, pending)}">
                <span class="step-index">03</span>
                <div class="step-copy"><p class="step-title">推送到 GitHub</p><p class="step-desc">${git.error ? 'Git 状态不可用' : pending ? `${git.ahead} 个提交待推送${git.behind ? ` · 落后远端 ${git.behind}` : ''}` : '本地与远端已同步'}</p></div>
              </div>
              <div class="deploy-step ${actions.status === 'completed' && actions.conclusion === 'success' ? 'is-done' : ['queued', 'in_progress'].includes(actions.status) ? 'is-active' : ''}">
                <span class="step-index">04</span>
                <div class="step-copy"><p class="step-title">GitHub Actions 构建</p><p class="step-desc">${esc(meta.label)}</p></div>
              </div>
            </div>
          </section>

          <section class="panel">
            <div class="panel-head"><h3>发布控制</h3><span class="mono muted">COMMIT &amp; PUSH</span></div>
            <div class="deploy-form">
              <label class="field">
                <span class="field-label">提交说明（可选）</span>
                <input class="input" type="text" id="deploy-message" maxlength="160" placeholder="留空则自动生成：内容更新 · 时间">
                <span class="field-hint">写清楚这次发布的核心变化，方便以后回看提交历史。</span>
              </label>
              <div style="display:flex;gap:10px;flex-wrap:wrap">
                <button class="btn btn-solid" type="button" data-deploy ${canDeploy ? '' : 'disabled'}>${icon('upload')} ${deployState.deploying ? '正在发布…' : '提交并发布'}</button>
                <button class="btn btn-ghost" type="button" data-rebuild-preview>${icon('refresh')} 仅重建预览</button>
              </div>
              <span class="field-hint" id="deploy-status-line">${deployState.deploying ? '正在执行 Git 提交与推送，请保持页面打开。' : '发布不会删除任何内容，只会把当前改动推送到 GitHub。'}</span>
            </div>
            <pre class="deploy-log">${git.error ? esc(git.error) : changes.length ? esc(changes.slice(0, 30).join('\n')) : 'WORKTREE CLEAN / 工作区没有未提交的改动'}</pre>
          </section>

          <section class="panel">
            <div class="panel-head"><h3>发布记录</h3><span class="mono muted">${history.length} RECORDS</span></div>
            <div class="history-list">
              ${history.length ? history.map((entry) => {
                const entryMeta = historyMeta(entry.status);
                return `<div class="history-row">
                  <span class="badge ${entryMeta.cls}">${entryMeta.label}</span>
                  <div class="history-main">
                    <span class="history-message">${esc(entry.message || '发布记录')}</span>
                    <span class="history-meta"><span>${fmtDateTime(entry.startedAt || entry.finishedAt)}</span>${entry.commit ? `<span>${esc(entry.commit)}</span>` : ''}${entry.error ? `<span class="danger-text">${esc(entry.error.slice(0, 100))}</span>` : ''}</span>
                  </div>
                </div>`;
              }).join('') : `<div class="empty"><strong>还没有发布记录</strong><p>第一次发布会在这里留下提交与时间。</p></div>`}
            </div>
          </section>
        </div>

        <aside class="dash-stack">
          <section class="panel">
            <div class="panel-head"><h3>线上状态</h3><span class="mono muted">LIVE</span></div>
            <div class="status-list">
              <div class="status-item">
                <span class="dot ${meta.dot}"></span>
                <div class="status-copy"><span class="status-label">GITHUB ACTIONS</span><span class="status-value">${esc(meta.label)}${actions.createdAt ? ` · ${fmtDateTime(actions.createdAt)}` : ''}</span></div>
              </div>
              <div class="status-item">
                <span class="dot is-live"></span>
                <div class="status-copy"><span class="status-label">PUBLIC SITE</span><span class="status-value">${esc(urls.site || SITE_URL)}</span></div>
              </div>
              <div class="status-item">
                <span class="dot ${previewMeta.dot}"></span>
                <div class="status-copy"><span class="status-label">PREVIEW</span><span class="status-value">${preview.building ? '正在构建预览' : preview.lastError ? esc(preview.lastError.slice(0, 120)) : preview.builtAt ? `就绪 · ${fmtDateTime(preview.builtAt)}` : '尚未构建'}</span></div>
              </div>
            </div>
            <div class="panel-body" style="display:flex;flex-direction:column;gap:8px;border-top:1px solid var(--line)">
              <a class="btn-link" href="${esc(urls.actions || ACTIONS_URL)}" target="_blank" rel="noopener noreferrer">${actions.url && actions.status !== 'unavailable' ? '查看最近一次 Actions 运行 ↗' : '打开 GitHub Actions ↗'}</a>
              <a class="btn-link" href="${esc(urls.site || SITE_URL)}" target="_blank" rel="noopener noreferrer">打开公开博客 ↗</a>
            </div>
          </section>

          <section class="panel">
            <div class="panel-head"><h3>预览构建</h3><span class="mono muted">SANDBOX</span></div>
            <div class="panel-body" style="display:flex;flex-direction:column;gap:10px">
              <p class="panel-note" style="margin:0">预览包含草稿与未来文章，只有登录后才能访问。发布前先在这里检查排版。</p>
              <a class="btn btn-ghost btn-block" href="${esc(urls.preview || '/preview/')}" target="_blank" rel="noopener noreferrer">${icon('eye')} 打开最新预览</a>
              <button class="btn btn-ghost btn-block" type="button" data-rebuild-preview>${icon('refresh')} 重新构建预览</button>
            </div>
          </section>

          <section class="panel">
            <div class="panel-head"><h3>仓库状态</h3><span class="mono muted">GIT</span></div>
            <div class="info-list">
              <div class="info-row"><span class="info-key">BRANCH</span><span class="info-value">${esc(git.branch || '—')}</span></div>
              <div class="info-row"><span class="info-key">CHANGES</span><span class="info-value">${git.error ? '—' : git.changeCount ?? 0}</span></div>
              <div class="info-row"><span class="info-key">AHEAD</span><span class="info-value">${git.error ? '—' : git.ahead ?? 0}</span></div>
              <div class="info-row"><span class="info-key">LAST COMMIT</span><span class="info-value">${git.lastCommit ? `${esc(git.lastCommit.short)}<br>${esc(git.lastCommit.subject)}` : '—'}</span></div>
            </div>
          </section>
        </aside>
      </div>
    </div>`;

  const deployButtons = qsa('[data-deploy]');
  const statusLine = qs('#deploy-status-line');
  let submitting = false;

  const runDeploy = async () => {
    if (submitting || deployState.deploying) return;
    if (git.error) {
      toast(git.error, 'error');
      return;
    }
    const message = qs('#deploy-message')?.value.trim() || '';
    const changeCount = git.changeCount || 0;
    const ahead = git.ahead || 0;
    const ok = await confirmDialog({
      title: '发布到线上？',
      message: changeCount > 0 || ahead > 0
        ? `将提交 ${changeCount} 个文件改动${ahead ? `，并推送 ${ahead} 个本地提交` : ''}。GitHub Actions 随后构建并更新公开博客。`
        : '当前工作区没有新改动，发布会检查仓库并推送已有提交。',
      confirmLabel: '立即发布',
      eyebrow: 'SHIP TO GITHUB',
    });
    if (!ok) return;
    submitting = true;
    deployButtons.forEach((button) => { button.disabled = true; });
    if (statusLine) statusLine.textContent = '正在执行 Git 提交与推送，请稍候…';
    try {
      const result = await api('/api/admin/deploy', { method: 'POST', body: { message } });
      if (result.result?.status === 'no_changes') {
        toast('没有需要发布的改动。', 'warn');
      } else {
        toast('已推送到 GitHub，Actions 正在构建。', 'ok');
      }
      await viewDeploy();
      refreshChrome();
    } catch (error) {
      toast(error.message, 'error');
      if (statusLine) statusLine.textContent = '发布失败，请检查右侧仓库状态与 Git 配置。';
      submitting = false;
      deployButtons.forEach((button) => { button.disabled = false; });
    }
  };

  deployButtons.forEach((button) => button.addEventListener('click', runDeploy));

  const rebuildPreview = async () => {
    const buttons = qsa('[data-rebuild-preview]');
    buttons.forEach((button) => { button.disabled = true; });
    try {
      await api('/api/admin/preview/rebuild', { method: 'POST' });
      toast('预览已重新构建。', 'ok');
      await viewDeploy();
      refreshChrome();
    } catch (error) {
      toast(error.message, 'error');
      buttons.forEach((button) => { button.disabled = false; });
    }
  };
  qsa('[data-rebuild-preview]').forEach((button) => button.addEventListener('click', rebuildPreview));

  qs('[data-refresh-deploy]')?.addEventListener('click', async () => {
    await viewDeploy();
    refreshChrome();
  });

  const watching = deployState.deploying || ['queued', 'in_progress'].includes(actions.status);
  if (watching) {
    let pollTimer = null;
    const schedulePoll = () => {
      pollTimer = window.setTimeout(async () => {
        if (state.currentRoute?.name !== 'deploy') return;
        if (document.activeElement?.id === 'deploy-message') {
          schedulePoll();
          return;
        }
        try {
          await viewDeploy();
        } catch {
          schedulePoll();
        }
      }, 6000);
    };
    schedulePoll();
    state.viewCleanup = () => {
      if (pollTimer) window.clearTimeout(pollTimer);
    };
  }
}

/* ---------- settings ---------- */

async function viewSettings() {
  setTopbar('SHIP / SETTINGS', '设置');
  const me = await api('/api/auth/me');
  state.user = me;
  const urls = me.urls || {};
  const viewEl = qs('#view');

  viewEl.innerHTML = `
    <div class="view-inner view-enter">
      <header class="page-head">
        <div class="page-head-copy">
          <span class="eyebrow">SHIP / CONTROL DECK SETTINGS</span>
          <h2>控制台设置</h2>
          <p>管理登录密码与会话，查看服务地址。内容与站点外观请前往站点设置、简历与标签页面维护。</p>
        </div>
        <div class="page-actions">
          <a class="btn btn-ghost" href="#/deploy">${icon('upload')} 发布部署</a>
        </div>
      </header>

      <div class="settings-grid">
        <section class="panel">
          <div class="panel-head"><h3>修改管理密码</h3><span class="mono muted">SECURITY</span></div>
          <form class="settings-form" id="password-form" autocomplete="off">
            <label class="field">
              <span class="field-label">当前密码</span>
              <input class="input" type="password" id="current-password" autocomplete="current-password" required>
            </label>
            <label class="field">
              <span class="field-label">新密码</span>
              <input class="input" type="password" id="new-password" autocomplete="new-password" minlength="10" required>
              <span class="field-hint">至少 10 位。修改后所有已登录会话会立即失效。</span>
            </label>
            <label class="field">
              <span class="field-label">确认新密码</span>
              <input class="input" type="password" id="confirm-password" autocomplete="new-password" required>
            </label>
            <span class="field-hint" id="password-status"></span>
            <div style="display:flex;gap:10px;flex-wrap:wrap">
              <button class="btn btn-solid" type="submit" id="save-password">${icon('lock')} 更新密码</button>
              <button class="btn btn-ghost" type="button" data-lock-console>${icon('logout')} 锁定控制台</button>
            </div>
          </form>
        </section>

        <div class="dash-stack">
          <section class="panel">
            <div class="panel-head"><h3>账号与会话</h3><span class="mono muted">SESSION</span></div>
            <div class="info-list">
              <div class="info-row"><span class="info-key">ROLE</span><span class="info-value">${esc(me.role || 'admin')}</span></div>
              <div class="info-row"><span class="info-key">SESSION</span><span class="info-value">v${esc(me.sessionVersion ?? 1)} · 7 天有效</span></div>
              <div class="info-row"><span class="info-key">PASSWORD</span><span class="info-value">${me.passwordUpdatedAt ? fmtDateTime(me.passwordUpdatedAt) : '尚未修改'}</span></div>
              <div class="info-row"><span class="info-key">ACCESS</span><span class="info-value">仅密码登录 · 无用户名</span></div>
            </div>
          </section>

          <section class="panel">
            <div class="panel-head"><h3>系统地址</h3><span class="mono muted">ENDPOINTS</span></div>
            <div class="info-list">
              <div class="info-row"><span class="info-key">ADMIN</span><span class="info-value"><a href="${esc(urls.admin || '/')}" target="_blank" rel="noopener noreferrer">${esc(urls.admin || location.origin)}</a></span></div>
              <div class="info-row"><span class="info-key">PUBLIC</span><span class="info-value"><a href="${esc(urls.site || SITE_URL)}" target="_blank" rel="noopener noreferrer">${esc(urls.site || SITE_URL)}</a></span></div>
              <div class="info-row"><span class="info-key">PREVIEW</span><span class="info-value"><a href="${esc(urls.preview || '/preview/')}" target="_blank" rel="noopener noreferrer">${esc(urls.preview || `${location.origin}/preview/`)}</a></span></div>
              <div class="info-row"><span class="info-key">GITHUB</span><span class="info-value"><a href="${esc(urls.github || GITHUB_URL)}" target="_blank" rel="noopener noreferrer">${esc(urls.github || GITHUB_URL)}</a></span></div>
              <div class="info-row"><span class="info-key">TIMEZONE</span><span class="info-value">Asia/Shanghai</span></div>
            </div>
          </section>

          <section class="panel">
            <div class="panel-head"><h3>维护</h3><span class="mono muted">MAINTENANCE</span></div>
            <div class="panel-body" style="display:flex;flex-direction:column;gap:8px">
              <button class="btn btn-ghost btn-block" type="button" data-settings-rebuild>${icon('refresh')} 重建博客预览</button>
              <a class="btn btn-ghost btn-block" href="#/site">${icon('site')} 编辑站点信息</a>
              <a class="btn btn-ghost btn-block" href="/api/health" target="_blank" rel="noopener noreferrer">${icon('check')} 健康检查</a>
              <p class="panel-note" style="margin:8px 0 0">端口、仓库路径、Hugo 路径等部署参数保存在服务器端的 <code>.env</code> 文件中，需要 SSH 登录后修改，不在浏览器中暴露。</p>
            </div>
          </section>
        </div>
      </div>
    </div>`;

  const passwordForm = qs('#password-form');
  const statusEl = qs('#password-status');

  passwordForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const currentPassword = qs('#current-password').value;
    const newPassword = qs('#new-password').value;
    const confirmPassword = qs('#confirm-password').value;
    if (!currentPassword) {
      toast('请输入当前密码。', 'warn');
      return;
    }
    if (newPassword.length < 10) {
      statusEl.textContent = '新密码至少需要 10 位。';
      return;
    }
    if (newPassword !== confirmPassword) {
      statusEl.textContent = '两次输入的新密码不一致。';
      return;
    }
    const button = qs('#save-password');
    button.disabled = true;
    button.textContent = '更新中…';
    statusEl.textContent = '';
    try {
      await api('/api/auth/password', { method: 'POST', body: { currentPassword, newPassword } });
      toast('管理密码已更新，请重新登录。', 'ok');
      window.setTimeout(() => renderLogin('管理密码已更新，请使用新密码重新登录。'), 500);
    } catch (error) {
      statusEl.textContent = error.message;
      button.disabled = false;
      button.innerHTML = `${icon('lock')} 更新密码`;
    }
  });

  qs('[data-lock-console]')?.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: '锁定控制台？',
      message: '当前会话将立即结束，需要重新输入密码才能继续。',
      confirmLabel: '锁定',
    });
    if (!ok) return;
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {
      /* cookie is cleared on the next render anyway */
    }
    renderLogin();
  });

  qs('[data-settings-rebuild]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = '正在构建…';
    try {
      await api('/api/admin/preview/rebuild', { method: 'POST' });
      toast('预览已重新构建。', 'ok');
      await viewSettings();
    } catch (error) {
      toast(error.message, 'error');
      button.disabled = false;
      button.innerHTML = `${icon('refresh')} 重建博客预览`;
    }
  });
}

/* ---------- boot ---------- */

async function boot() {
  try {
    const me = await api('/api/auth/me', { redirectOn401: false });
    state.user = me;
    renderShell();
    await handleRoute();
    refreshChrome();
  } catch (error) {
    if (error.status === 401) {
      renderLogin();
      return;
    }
    appEl.innerHTML = `
      <div class="boot-screen">
        <span class="boot-mark">AI</span>
        <strong style="color:var(--text)">控制台暂时无法连接</strong>
        <span class="mono">${esc(error.message || 'NETWORK ERROR')}</span>
        <button class="btn btn-ghost" type="button" data-boot-retry>${icon('refresh')} 重试连接</button>
      </div>`;
    qs('[data-boot-retry]')?.addEventListener('click', boot);
  }
}

boot();
