import crypto from 'node:crypto';
import { config } from './config.js';
import {
  cleanSingleLine,
  cleanText,
  httpError,
  normalizeEmail,
  normalizeHttpUrl,
  readJson,
  writeJson,
} from './util.js';
import { getPost, postStems } from './posts.js';

const VALID_STATUSES = new Set(['pending', 'approved', 'hidden', 'spam']);
const MAX_COMMENTS = 5000;

const store = {
  loaded: false,
  comments: [],
};
let persistQueue = Promise.resolve();

async function load() {
  if (store.loaded) return;
  const data = await readJson(config.commentsFile, { version: 1, comments: [] });
  store.comments = Array.isArray(data.comments)
    ? data.comments.filter((comment) => comment && comment.id && comment.content)
    : [];
  store.loaded = true;
}

function persist() {
  const snapshot = { version: 1, comments: store.comments };
  persistQueue = persistQueue.then(() => writeJson(config.commentsFile, snapshot));
  return persistQueue;
}

function newId() {
  return `c_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
}

function normalizePostStem(value) {
  let post = String(value || '').trim();
  post = post.replace(/^https?:\/\/[^/]+/i, '');
  post = post.replace(/^\/+/, '').replace(/^posts\//, '');
  post = post.replace(/[?#].*$/, '').replace(/\/+$/, '');
  if (post.endsWith('.md')) post = post.slice(0, -3);
  return post;
}

function publicComment(comment) {
  return {
    id: comment.id,
    author: comment.author,
    content: comment.content,
    website: comment.website || '',
    created_at: comment.created_at,
  };
}

export async function initComments() {
  await load();
}

export async function listPublicComments(postValue) {
  await load();
  const post = normalizePostStem(postValue);
  if (!post) throw httpError(400, '缺少文章标识。');
  return store.comments
    .filter((comment) => comment.post === post && comment.status === 'approved')
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    .slice(-200)
    .map(publicComment);
}

export async function createComment(input, context = {}) {
  await load();
  if (store.comments.length >= MAX_COMMENTS) {
    throw httpError(503, '评论存储已满，请稍后再试。');
  }

  if (cleanSingleLine(input.website_url, 100)) {
    return { ok: true, stored: false };
  }

  const post = normalizePostStem(input.post);
  if (!post) throw httpError(400, '缺少文章标识。');
  const stems = await postStems();
  if (!stems.has(post)) throw httpError(404, '文章不存在或已下线。');

  const author = cleanSingleLine(input.author, 40);
  if (!author) throw httpError(400, '请填写称呼。');
  const content = cleanText(input.content, 2100);
  if (content.length < 2) throw httpError(400, '评论内容太短。');
  if (content.length > 2000) throw httpError(400, '评论内容不能超过 2000 个字符。');

  const rawEmail = cleanSingleLine(input.email, 160);
  const email = rawEmail ? normalizeEmail(rawEmail) : '';
  if (rawEmail && !email) throw httpError(400, '邮箱格式不正确。');

  const rawWebsite = cleanSingleLine(input.website, 300);
  const website = rawWebsite ? normalizeHttpUrl(rawWebsite, 300) : '';
  if (rawWebsite && !website) throw httpError(400, '网站地址需要以 http(s) 开头。');

  let postTitle = post;
  try {
    const detail = await getPost(post);
    postTitle = detail.title;
  } catch {
    /* post may disappear between checks; keep the stem */
  }

  const now = new Date().toISOString();
  const comment = {
    id: newId(),
    post,
    post_title: postTitle,
    author,
    email,
    website,
    content,
    status: 'pending',
    created_at: now,
    updated_at: now,
    ip_hash: context.ipHash || '',
    user_agent: cleanSingleLine(context.userAgent, 220),
  };
  store.comments.push(comment);
  await persist();
  return { ok: true, stored: true, comment: { id: comment.id, status: comment.status } };
}

export async function listAdminComments({ status = 'all', post = '', search = '' } = {}) {
  await load();
  const normalizedStatus = VALID_STATUSES.has(status) ? status : 'all';
  const searchText = cleanSingleLine(search, 100).toLowerCase();
  const items = store.comments
    .filter((comment) => (normalizedStatus === 'all' ? true : comment.status === normalizedStatus))
    .filter((comment) => (post ? comment.post === normalizePostStem(post) : true))
    .filter((comment) => {
      if (!searchText) return true;
      return [comment.author, comment.content, comment.post_title, comment.email]
        .join(' ')
        .toLowerCase()
        .includes(searchText);
    })
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  return {
    comments: items.map((comment) => ({
      ...comment,
      email: comment.email || '',
    })),
    counts: commentCounts(),
  };
}

export function commentCounts() {
  const counts = { all: store.comments.length, pending: 0, approved: 0, hidden: 0, spam: 0 };
  for (const comment of store.comments) {
    if (counts[comment.status] !== undefined) counts[comment.status] += 1;
  }
  return counts;
}

export async function countApprovedForPost(postValue) {
  await load();
  const post = normalizePostStem(postValue);
  return store.comments.filter((comment) => comment.post === post && comment.status === 'approved').length;
}

export async function updateCommentStatus(id, status) {
  await load();
  if (!VALID_STATUSES.has(status)) throw httpError(400, '评论状态无效。');
  const comment = store.comments.find((item) => item.id === id);
  if (!comment) throw httpError(404, '评论不存在。');
  comment.status = status;
  comment.updated_at = new Date().toISOString();
  await persist();
  return comment;
}

export async function bulkUpdateStatus(ids, status) {
  await load();
  if (!VALID_STATUSES.has(status)) throw httpError(400, '评论状态无效。');
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 200) {
    throw httpError(400, '请选择要处理的评论。');
  }
  const idSet = new Set(ids.map(String));
  let updated = 0;
  for (const comment of store.comments) {
    if (!idSet.has(comment.id)) continue;
    comment.status = status;
    comment.updated_at = new Date().toISOString();
    updated += 1;
  }
  if (updated > 0) await persist();
  return { updated };
}

export async function deleteComment(id) {
  await load();
  const index = store.comments.findIndex((item) => item.id === id);
  if (index === -1) throw httpError(404, '评论不存在。');
  const [removed] = store.comments.splice(index, 1);
  await persist();
  return removed;
}

export async function migratePostKey(oldPost, newPost, postTitle) {
  await load();
  let updated = 0;
  for (const comment of store.comments) {
    if (comment.post !== oldPost) continue;
    comment.post = newPost;
    if (postTitle) comment.post_title = postTitle;
    updated += 1;
  }
  if (updated > 0) await persist();
  return updated;
}

export async function recentPending(limit = 5) {
  await load();
  return store.comments
    .filter((comment) => comment.status === 'pending')
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, limit);
}
