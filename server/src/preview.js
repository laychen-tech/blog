import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config } from './config.js';
import { httpError, readJson, writeJson } from './util.js';

const KEEP_RELEASES = 6;
const BUILD_TIMEOUT_MS = 90 * 1000;

const state = {
  release: null,
  builtAt: null,
  building: false,
  pending: false,
  lastError: null,
  lastDurationMs: null,
};

let timer = null;
let chain = Promise.resolve();

function releaseName() {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '');
  return `${stamp}-${Math.random().toString(16).slice(2, 6)}`;
}

export async function initPreview() {
  const stored = await readJson(config.previewStateFile, null);
  if (stored?.release) {
    state.release = stored.release;
    state.builtAt = stored.builtAt || null;
    state.lastError = stored.lastError || null;
  }
  const root = currentRoot();
  if (!root) {
    scheduleBuild(200);
    return;
  }
  try {
    await fs.access(path.join(root, 'index.html'));
  } catch {
    state.release = null;
    scheduleBuild(200);
  }
}

export function currentRoot() {
  if (!state.release) return null;
  return path.join(config.releasesDir, state.release);
}

export function getPreviewState() {
  return {
    release: state.release,
    root: currentRoot(),
    builtAt: state.builtAt,
    building: state.building,
    pending: state.pending,
    lastError: state.lastError,
    lastDurationMs: state.lastDurationMs,
    url: config.previewBaseUrl,
  };
}

export function scheduleBuild(delay = 300) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    enqueueBuild();
  }, delay);
}

function enqueueBuild() {
  if (state.building) {
    state.pending = true;
    return chain;
  }

  state.building = true;
  state.lastError = null;
  chain = runBuild()
    .catch((error) => {
      state.lastError = error.message;
      console.error('[preview] 构建失败:', error.message);
    })
    .finally(() => {
      state.building = false;
      if (state.pending) {
        state.pending = false;
        scheduleBuild(120);
      }
    });
  return chain;
}

export async function rebuildNow() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (state.building) {
    state.pending = true;
    await chain;
    return getPreviewState();
  }
  await enqueueBuild();
  if (state.pending) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    await chain;
  }
  return getPreviewState();
}

async function runBuild() {
  await fs.mkdir(config.releasesDir, { recursive: true });
  const release = releaseName();
  const staging = path.join(config.releasesDir, `.building-${release}`);
  const target = path.join(config.releasesDir, release);
  const started = Date.now();

  try {
    await runHugo(staging);
    await fs.access(path.join(staging, 'index.html'));
    await fs.rename(staging, target);
    await cleanupReleases(release);

    state.release = release;
    state.builtAt = new Date().toISOString();
    state.lastDurationMs = Date.now() - started;
    await writeJson(config.previewStateFile, {
      release,
      builtAt: state.builtAt,
      durationMs: state.lastDurationMs,
      baseUrl: config.previewBaseUrl,
      error: null,
    });
    console.log(`[preview] 构建完成 ${release} (${state.lastDurationMs}ms)`);
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
    state.lastError = error.message;
    state.lastDurationMs = Date.now() - started;
    await writeJson(config.previewStateFile, {
      release: state.release,
      builtAt: state.builtAt,
      baseUrl: config.previewBaseUrl,
      error: error.message,
    }).catch(() => {});
    throw error;
  }
}

function runHugo(destination) {
  const args = [
    '--source', config.repoDir,
    '--destination', destination,
    '--baseURL', config.previewBaseUrl,
    '--buildDrafts',
    '--buildFuture',
    '--cleanDestinationDir',
    '--minify',
    '--gc',
  ];

  return new Promise((resolve, reject) => {
    let output = '';
    const child = spawn(config.hugoBin, args, {
      cwd: config.repoDir,
      env: { ...process.env, HUGO_ENV: 'preview' },
      windowsHide: true,
    });

    const timerId = setTimeout(() => {
      child.kill('SIGKILL');
      reject(httpError(504, 'Hugo 构建超时（90 秒）。'));
    }, BUILD_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
      if (output.length > 12000) output = output.slice(-12000);
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
      if (output.length > 12000) output = output.slice(-12000);
    });

    child.on('error', (error) => {
      clearTimeout(timerId);
      if (error.code === 'ENOENT') {
        reject(httpError(500, `找不到 Hugo 可执行文件：${config.hugoBin}`));
        return;
      }
      reject(httpError(500, `Hugo 启动失败：${error.message}`));
    });

    child.on('close', (code) => {
      clearTimeout(timerId);
      if (code === 0) {
        resolve();
        return;
      }
      const detail = output.split('\n').filter(Boolean).slice(-12).join('\n');
      reject(httpError(500, `Hugo 构建失败（退出码 ${code}）${detail ? `：\n${detail}` : ''}`));
    });
  });
}

async function cleanupReleases(keep) {
  const entries = await fs.readdir(config.releasesDir, { withFileTypes: true });
  const directories = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.building-')) {
      const full = path.join(config.releasesDir, entry.name);
      const stat = await fs.stat(full).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs > 10 * 60 * 1000) {
        await fs.rm(full, { recursive: true, force: true }).catch(() => {});
      }
      continue;
    }
    directories.push(entry.name);
  }
  directories.sort((a, b) => b.localeCompare(a));
  const stale = directories.filter((name) => name !== keep).slice(KEEP_RELEASES - 1);
  for (const name of stale) {
    await fs.rm(path.join(config.releasesDir, name), { recursive: true, force: true }).catch(() => {});
  }
}
