import { spawn } from 'node:child_process';
import { config } from './config.js';
import { formatDateTime, httpError, readJson, writeJson } from './util.js';
import { getPreviewState } from './preview.js';

const MAX_HISTORY = 30;
const state = {
  deploying: false,
  startedAt: null,
  currentMessage: '',
  lastResult: null,
};
let actionsCache = { at: 0, value: null };

function runGit(args, { timeout = 60000 } = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const child = spawn('git', ['-C', config.repoDir, ...args], {
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_AUTHOR_NAME: config.gitUserName,
        GIT_AUTHOR_EMAIL: config.gitUserEmail,
        GIT_COMMITTER_NAME: config.gitUserName,
        GIT_COMMITTER_EMAIL: config.gitUserEmail,
      },
      windowsHide: true,
    });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      stderr += '\n操作超时。';
    }, timeout);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: error.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

async function git(args, options) {
  const result = await runGit(args, options);
  if (result.code !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join('\n').slice(-3000);
    throw httpError(500, `Git 操作失败：${detail || `退出码 ${result.code}`}`);
  }
  return result.stdout;
}

async function assertRepository() {
  const result = await runGit(['rev-parse', '--is-inside-work-tree']);
  if (result.code !== 0 || result.stdout !== 'true') {
    throw httpError(500, '当前目录不是 Git 仓库，无法部署。');
  }
}

async function getAheadBehind() {
  const result = await runGit(['rev-list', '--left-right', '--count', '@{u}...HEAD']);
  if (result.code !== 0) return { ahead: 0, behind: 0 };
  const [behind, ahead] = result.stdout.split(/\s+/).map(Number);
  return { ahead: ahead || 0, behind: behind || 0 };
}

async function getLastCommit() {
  const result = await runGit(['log', '-1', '--format=%H%x1f%h%x1f%s%x1f%cI%x1f%an']);
  if (result.code !== 0 || !result.stdout) return null;
  const [hash, short, subject, date, author] = result.stdout.split('\x1f');
  return { hash, short, subject, date, author };
}

export async function getGitStatus() {
  await assertRepository();
  const [porcelain, branch, lastCommit, aheadBehind] = await Promise.all([
    runGit(['status', '--porcelain=v1']).then((result) => result.stdout),
    runGit(['rev-parse', '--abbrev-ref', 'HEAD']).then((result) => result.stdout || config.gitBranch),
    getLastCommit(),
    getAheadBehind(),
  ]);
  const changes = porcelain ? porcelain.split('\n').filter(Boolean) : [];
  return {
    branch,
    clean: changes.length === 0,
    changes: changes.slice(0, 100),
    changeCount: changes.length,
    lastCommit,
    ...aheadBehind,
  };
}

export async function getActionsStatus() {
  if (actionsCache.value && Date.now() - actionsCache.at < 30000) {
    return actionsCache.value;
  }
  const fallback = {
    status: 'unavailable',
    conclusion: null,
    url: `https://github.com/${config.githubRepo}/actions`,
    message: '',
  };
  try {
    const response = await fetch(
      `https://api.github.com/repos/${config.githubRepo}/actions/runs?per_page=1`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'ai-revolution-control-deck',
        },
        signal: AbortSignal.timeout(6000),
      }
    );
    if (!response.ok) {
      fallback.message = response.status === 403 ? 'GitHub API 访问受限' : `GitHub API ${response.status}`;
      actionsCache = { at: Date.now(), value: fallback };
      return fallback;
    }
    const data = await response.json();
    const run = Array.isArray(data.workflow_runs) ? data.workflow_runs[0] : null;
    if (!run) {
      actionsCache = {
        at: Date.now(),
        value: { ...fallback, status: 'none', message: '还没有发布记录' },
      };
      return actionsCache.value;
    }
    const value = {
      status: run.status,
      conclusion: run.conclusion,
      url: run.html_url,
      name: run.name,
      createdAt: run.created_at,
      updatedAt: run.updated_at,
      headSha: run.head_sha,
    };
    actionsCache = { at: Date.now(), value };
    return value;
  } catch (error) {
    fallback.message = error.name === 'TimeoutError' ? 'GitHub API 超时' : '无法连接 GitHub API';
    actionsCache = { at: Date.now(), value: fallback };
    return fallback;
  }
}

export async function getDeployState() {
  return {
    deploying: state.deploying,
    startedAt: state.startedAt,
    currentMessage: state.currentMessage,
    lastResult: state.lastResult,
  };
}

export async function getDeployHistory() {
  const data = await readJson(config.deploysFile, { version: 1, deploys: [] });
  return Array.isArray(data.deploys) ? data.deploys : [];
}

async function saveHistory(record) {
  const data = await readJson(config.deploysFile, { version: 1, deploys: [] });
  const deploys = Array.isArray(data.deploys) ? data.deploys : [];
  deploys.unshift(record);
  await writeJson(config.deploysFile, { version: 1, deploys: deploys.slice(0, MAX_HISTORY) });
}

function defaultMessage(changeCount) {
  const stamp = formatDateTime(new Date(), config.timeZone);
  return `内容更新 · ${stamp}${changeCount ? ` · ${changeCount} 个文件` : ''}`;
}

export async function deploy({ message } = {}) {
  if (state.deploying) throw httpError(409, '已有发布任务正在进行。');
  await assertRepository();

  const startedAt = new Date().toISOString();
  state.deploying = true;
  state.startedAt = startedAt;

  try {
    await git(['add', '-A']);
    const porcelain = await git(['status', '--porcelain=v1']);
    const changeCount = porcelain ? porcelain.split('\n').filter(Boolean).length : 0;
    let commit = await getLastCommit();
    let committed = false;

    if (changeCount > 0) {
      const commitMessage = String(message || '').trim().slice(0, 160) || defaultMessage(changeCount);
      state.currentMessage = commitMessage;
      await git(['commit', '-m', commitMessage], { timeout: 30000 });
      committed = true;
      commit = await getLastCommit();
    }

    const { ahead } = await getAheadBehind();
    if (!committed && ahead === 0) {
      state.lastResult = {
        status: 'no_changes',
        at: new Date().toISOString(),
        message: '没有需要发布的改动。',
        commit,
      };
      await saveHistory({
        id: `d_${Date.now().toString(36)}`,
        status: 'no_changes',
        message: '没有需要发布的改动。',
        commit: commit?.short || '',
        startedAt,
        finishedAt: new Date().toISOString(),
        error: '',
        log: '',
      });
      return {
        status: 'no_changes',
        message: '没有需要发布的改动。',
        commit,
        publicUrl: config.publicSiteUrl,
      };
    }

    state.currentMessage = message || commit?.subject || '';
    const push = await runGit(
      ['push', '-u', config.gitRemote, `HEAD:refs/heads/${config.gitBranch}`],
      { timeout: 120000 }
    );
    const pushLog = [push.stdout, push.stderr].filter(Boolean).join('\n').slice(-3000);
    if (push.code !== 0) {
      throw httpError(500, `推送失败：${pushLog.slice(-1200)}`);
    }

    const finishedAt = new Date().toISOString();
    const result = {
      status: 'success',
      at: finishedAt,
      message: state.currentMessage || commit?.subject || '发布完成',
      commit,
      actionsUrl: `https://github.com/${config.githubRepo}/actions`,
      publicUrl: config.publicSiteUrl,
      log: pushLog,
    };
    state.lastResult = result;
    actionsCache = { at: 0, value: null };
    await saveHistory({
      id: `d_${Date.now().toString(36)}`,
      status: 'success',
      message: result.message,
      commit: commit?.short || '',
      commitHash: commit?.hash || '',
      startedAt,
      finishedAt,
      error: '',
      log: pushLog,
    });
    return result;
  } catch (error) {
    const finishedAt = new Date().toISOString();
    const failure = {
      status: 'failed',
      at: finishedAt,
      message: state.currentMessage || '发布失败',
      error: error.message,
    };
    state.lastResult = failure;
    await saveHistory({
      id: `d_${Date.now().toString(36)}`,
      status: 'failed',
      message: failure.message,
      commit: '',
      startedAt,
      finishedAt,
      error: error.message,
      log: '',
    }).catch(() => {});
    throw error;
  } finally {
    state.deploying = false;
    state.startedAt = null;
    state.currentMessage = '';
  }
}

export function deployOverview() {
  return {
    ...state,
    preview: getPreviewState(),
    publicUrl: config.publicSiteUrl,
    actionsUrl: `https://github.com/${config.githubRepo}/actions`,
  };
}
