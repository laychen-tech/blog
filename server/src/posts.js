import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { config } from './config.js';
import {
  cleanSingleLine,
  cleanText,
  countWords,
  excerptFromMarkdown,
  generatePostId,
  httpError,
  isValidPostId,
  normalizeHttpUrl,
  normalizePostDate,
  readJson,
  readText,
  slugify,
  toDateTimeLocal,
  toBoolean,
  writeTextAtomic,
} from './util.js';

const POST_EXTENSION = '.md';

function postFile(id) {
  return path.join(config.postsDir, `${id}${POST_EXTENSION}`);
}

function parseTags(value) {
  let source = value;
  if (typeof value === 'string') {
    source = value.split(/[,，、\n]/);
  }
  if (!Array.isArray(source)) return [];
  const seen = new Set();
  const tags = [];
  for (const item of source) {
    const tag = cleanSingleLine(String(item ?? ''), 30);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
    if (tags.length >= 8) break;
  }
  return tags;
}

function normalizeCover(value) {
  const cover = cleanSingleLine(value, 500);
  if (!cover) return '';
  if (cover.startsWith('/')) return cover;
  return normalizeHttpUrl(cover, 500);
}

function normalizeDateValue(value) {
  if (!value) return new Date().toISOString();
  if (value instanceof Date) return value.toISOString();
  return normalizePostDate(value);
}

function normalizePostInput(input, { partial = false } = {}) {
  const body = cleanText(input.body ?? input.content ?? '', 300000);
  const title = cleanSingleLine(input.title, 140);
  if (!partial && !title) throw httpError(400, '标题不能为空。');
  if (title && title.length < 1) throw httpError(400, '标题不能为空。');

  const summary = cleanText(input.summary, 320);
  if (!partial && summary.length > 300) throw httpError(400, '摘要不能超过 300 个字符。');

  const cover = normalizeCover(input.cover);
  if (input.cover && !cover) throw httpError(400, '封面地址必须是站内路径或 http(s) 链接。');

  return {
    title,
    date: normalizeDateValue(input.date),
    draft: toBoolean(input.draft, false),
    featured: toBoolean(input.featured, false),
    tags: parseTags(input.tags),
    summary,
    cover,
    body,
  };
}

function serializePost(data, body) {
  const ordered = {
    title: data.title,
    date: data.date,
    lastmod: data.lastmod,
    draft: Boolean(data.draft),
    featured: Boolean(data.featured),
    tags: Array.isArray(data.tags) ? data.tags : [],
  };
  if (data.summary) ordered.summary = data.summary;
  if (data.cover) ordered.cover = data.cover;
  Object.keys(data).forEach((key) => {
    if (!(key in ordered)) ordered[key] = data[key];
  });
  return matter.stringify(body, ordered);
}

function mapPost(id, filePath, parsed, stat) {
  const data = parsed.data || {};
  const body = parsed.content || '';
  const dateValue = normalizeDateValue(data.date);
  const date = new Date(dateValue);
  const wordCount = countWords(body);
  return {
    id,
    title: data.title || '(无标题)',
    date: Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString(),
    dateLocal: toDateTimeLocal(data.date),
    draft: Boolean(data.draft),
    featured: Boolean(data.featured),
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    summary: data.summary || excerptFromMarkdown(body, 120),
    cover: data.cover || '',
    readingTime: Math.max(1, Math.ceil(wordCount / 350)),
    wordCount,
    updatedAt: stat?.mtime?.toISOString() || new Date().toISOString(),
    url: `/posts/${id}/`,
  };
}

export async function ensurePostsDir() {
  await fs.mkdir(config.postsDir, { recursive: true });
}

export async function listPosts() {
  await ensurePostsDir();
  const entries = await fs.readdir(config.postsDir, { withFileTypes: true });
  const posts = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(POST_EXTENSION)) continue;
    const id = entry.name.slice(0, -POST_EXTENSION.length);
    if (id === '_index') continue;
    const filePath = path.join(config.postsDir, entry.name);
    try {
      const [raw, stat] = await Promise.all([fs.readFile(filePath, 'utf8'), fs.stat(filePath)]);
      const parsed = matter(raw);
      posts.push(mapPost(id, filePath, parsed, stat));
    } catch (error) {
      console.error(`[posts] 无法读取 ${entry.name}:`, error.message);
    }
  }
  posts.sort((a, b) => new Date(b.date) - new Date(a.date));
  return posts;
}

export async function getPost(id) {
  if (!isValidPostId(id)) throw httpError(400, '文章 ID 无效。');
  const raw = await readText(postFile(id));
  if (raw === null) throw httpError(404, '文章不存在。');
  const stat = await fs.stat(postFile(id));
  const parsed = matter(raw);
  const base = mapPost(id, postFile(id), parsed, stat);
  return {
    ...base,
    summary: parsed.data.summary || '',
    excerpt: base.summary,
    body: parsed.content || '',
    rawFrontMatter: parsed.data,
    previewUrl: new URL(`posts/${id}/`, config.previewBaseUrl).toString(),
    publicUrl: new URL(`posts/${id}/`, config.publicSiteUrl).toString(),
  };
}

export async function createPost(input) {
  await ensurePostsDir();
  const normalized = normalizePostInput(input);
  let requested = '';
  if (input.id || input.slug) {
    requested = slugify(input.id || input.slug);
    if (!requested && cleanSingleLine(input.id || input.slug, 100)) {
      throw httpError(400, '文章 ID 只能使用小写字母、数字和连字符。');
    }
  }
  const id = requested || generatePostId();
  if (!isValidPostId(id)) throw httpError(400, '文章 ID 只能使用小写字母、数字和连字符。');

  const target = postFile(id);
  try {
    await fs.access(target);
    throw httpError(409, '这个文章 ID 已被占用，请换一个。');
  } catch (error) {
    if (error.status) throw error;
  }

  const data = {
    title: normalized.title,
    date: normalized.date,
    lastmod: new Date().toISOString(),
    draft: normalized.draft,
    featured: normalized.featured,
    tags: normalized.tags,
    ...(normalized.summary ? { summary: normalized.summary } : {}),
    ...(normalized.cover ? { cover: normalized.cover } : {}),
  };
  await writeTextAtomic(target, serializePost(data, normalized.body));
  return getPost(id);
}

export async function updatePost(id, input) {
  if (!isValidPostId(id)) throw httpError(400, '文章 ID 无效。');
  const existingRaw = await readText(postFile(id));
  if (existingRaw === null) throw httpError(404, '文章不存在。');
  const existing = matter(existingRaw);
  const normalized = normalizePostInput(input, { partial: !input.title });

  let nextId = id;
  if (input.newId && slugify(input.newId) !== id) {
    const candidate = slugify(input.newId);
    if (!candidate) throw httpError(400, '文章 ID 只能使用小写字母、数字和连字符。');
    if (!isValidPostId(candidate)) throw httpError(400, '文章 ID 格式无效。');
    try {
      await fs.access(postFile(candidate));
      throw httpError(409, '目标文章 ID 已被占用。');
    } catch (error) {
      if (error.status) throw error;
    }
    nextId = candidate;
  }

  const data = {
    ...existing.data,
    ...(normalized.title ? { title: normalized.title } : {}),
    date: normalized.date,
    lastmod: new Date().toISOString(),
    draft: normalized.draft,
    featured: normalized.featured,
    tags: normalized.tags,
    summary: normalized.summary,
    cover: normalized.cover,
  };
  if (!normalized.summary) delete data.summary;
  if (!normalized.cover) delete data.cover;

  const serialized = serializePost(data, normalized.body);
  if (nextId !== id) {
    await fs.rename(postFile(id), postFile(nextId));
  }
  await writeTextAtomic(postFile(nextId), serialized);
  return getPost(nextId);
}

export async function deletePost(id) {
  if (!isValidPostId(id)) throw httpError(400, '文章 ID 无效。');
  const source = postFile(id);
  try {
    await fs.access(source);
  } catch {
    throw httpError(404, '文章不存在。');
  }
  await fs.mkdir(config.trashDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(config.trashDir, `${id}-${stamp}.md`);
  try {
    await fs.rename(source, target);
  } catch {
    await fs.copyFile(source, target);
    await fs.unlink(source);
  }
  return { id, trashedTo: path.basename(target) };
}

export async function postStems() {
  const posts = await listPosts();
  return new Set(posts.map((post) => post.id));
}

export async function countTags() {
  const posts = await listPosts();
  const usage = new Map();
  for (const post of posts) {
    for (const tag of post.tags) {
      usage.set(tag, (usage.get(tag) || 0) + 1);
    }
  }
  return usage;
}

export async function renameTag(from, to) {
  const oldTag = cleanSingleLine(from, 30);
  const newTag = cleanSingleLine(to, 30);
  if (!oldTag || !newTag) throw httpError(400, '标签名称不能为空。');
  if (oldTag === newTag) return { updated: 0 };

  const posts = await listPosts();
  let updated = 0;
  for (const post of posts) {
    if (!post.tags.includes(oldTag)) continue;
    const detail = await getPost(post.id);
    const tags = post.tags.map((tag) => (tag === oldTag ? newTag : tag));
    await updatePost(post.id, { ...detail, tags, date: detail.dateLocal });
    updated += 1;
  }
  return { updated };
}

export async function removeTag(name) {
  const target = cleanSingleLine(name, 30);
  if (!target) throw httpError(400, '标签名称不能为空。');
  const posts = await listPosts();
  let updated = 0;
  for (const post of posts) {
    if (!post.tags.includes(target)) continue;
    const detail = await getPost(post.id);
    const tags = post.tags.filter((tag) => tag !== target);
    await updatePost(post.id, { ...detail, tags, date: detail.dateLocal });
    updated += 1;
  }
  return { updated };
}

export async function getTagDescriptions() {
  return readJson(config.tagsDataFile, {});
}
