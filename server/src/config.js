import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function env(name, fallback = '') {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function resolveFromServer(value, fallback) {
  return path.resolve(value || fallback);
}

const isProduction = env('NODE_ENV', 'development') === 'production';
const repoDir = resolveFromServer(env('REPO_DIR'), path.resolve(serverDir, '..'));
const dataDir = resolveFromServer(env('DATA_DIR'), path.join(serverDir, 'data'));
const releasesDir = resolveFromServer(env('RELEASES_DIR'), path.join(serverDir, 'releases'));

let sessionSecret = env('SESSION_SECRET');
if (!sessionSecret) {
  if (isProduction) {
    throw new Error('SESSION_SECRET is required in production');
  }
  sessionSecret = crypto.randomBytes(32).toString('hex');
}

const port = Number(env('PORT', '8787'));
const previewBaseUrl = env(
  'PREVIEW_BASE_URL',
  `http://127.0.0.1:${port}/preview/`
).replace(/\/?$/, '/');

export const config = {
  isProduction,
  port,
  host: env('HOST', isProduction ? '127.0.0.1' : '0.0.0.0'),
  serverDir,
  repoDir,
  dataDir,
  releasesDir,
  postsDir: path.join(repoDir, 'content', 'posts'),
  staticDir: path.join(repoDir, 'static'),
  uploadsDir: path.join(repoDir, 'static', 'uploads'),
  siteDataFile: path.join(repoDir, 'data', 'site.json'),
  resumeDataFile: path.join(repoDir, 'data', 'resume.json'),
  tagsDataFile: path.join(repoDir, 'data', 'tags.json'),
  adminDir: path.join(serverDir, 'public', 'admin'),
  authFile: path.join(dataDir, 'auth.json'),
  commentsFile: path.join(dataDir, 'comments.json'),
  deploysFile: path.join(dataDir, 'deploys.json'),
  previewStateFile: path.join(dataDir, 'preview.json'),
  trashDir: path.join(dataDir, 'trash'),
  sessionSecret,
  sessionCookie: 'ai_blog_session',
  sessionMaxAgeMs: 7 * 24 * 60 * 60 * 1000,
  adminInitialPassword: env('ADMIN_INITIAL_PASSWORD'),
  hugoBin: env('HUGO_BIN', 'hugo'),
  previewBaseUrl,
  publicSiteUrl: env('PUBLIC_SITE_URL', 'https://laychen-tech.github.io/blog/').replace(/\/?$/, '/'),
  adminPublicUrl: env('ADMIN_PUBLIC_URL', 'https://47-117-122-253.sslip.io').replace(/\/?$/, ''),
  githubRepo: env('GITHUB_REPO', 'laychen-tech/blog'),
  gitBranch: env('GIT_BRANCH', 'main'),
  gitRemote: env('GIT_REMOTE', 'origin'),
  gitUserName: env('GIT_USER_NAME', 'AI Blog Control'),
  gitUserEmail: env('GIT_USER_EMAIL', 'laihub@163.com'),
  timeZone: env('SITE_TIME_ZONE', 'Asia/Shanghai'),
  uploadMaxBytes: 8 * 1024 * 1024,
};

export function ensureRuntimeDirs() {
  for (const dir of [config.dataDir, config.releasesDir, config.trashDir, config.uploadsDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
