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
import { countTags, getTagDescriptions, removeTag, renameTag } from './posts.js';

function text(value, max = 500) {
  return cleanSingleLine(value, max);
}

function multiline(value, max = 3000) {
  return cleanText(value, max);
}

function asObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw httpError(400, `${label} 必须是对象。`);
  }
  return value;
}

function asArray(value, label, limit = 30) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw httpError(400, `${label} 必须是数组。`);
  return value.slice(0, limit);
}

function requireUrl(value, label) {
  const url = normalizeHttpUrl(value, 500);
  if (!url) throw httpError(400, `${label} 必须是有效的 http(s) 地址。`);
  return url;
}

export async function getSiteData() {
  return readJson(config.siteDataFile, {});
}

export async function saveSiteData(input) {
  const raw = asObject(input, '站点数据');
  const author = asObject(raw.author || {}, '作者信息');
  const hero = asObject(raw.hero || {}, '首页信息');
  const home = asObject(raw.home || {}, '首页文案');
  const pages = asObject(raw.pages || {}, '页面文案');

  const email = text(raw.email, 160);
  if (email && !normalizeEmail(email)) throw httpError(400, '邮箱格式不正确。');
  const github = text(raw.github, 300);
  if (github && !normalizeHttpUrl(github, 300)) {
    throw httpError(400, 'GitHub 地址必须是有效的 http(s) 链接。');
  }
  const commentApiBase = text(raw.commentApiBase, 300);
  if (commentApiBase && !normalizeHttpUrl(commentApiBase, 300)) {
    throw httpError(400, '评论服务地址必须是有效的 http(s) 链接。');
  }

  const primaryCta = asObject(hero.primaryCta || {}, '主按钮');
  const secondaryCta = asObject(hero.secondaryCta || {}, '次按钮');

  const next = {
    ...raw,
    title: text(raw.title, 80) || 'AI 革命',
    titleEn: text(raw.titleEn, 120),
    description: multiline(raw.description, 500),
    keywords: asArray(raw.keywords, '关键词', 20).map((item) => text(item, 40)).filter(Boolean),
    author: {
      ...author,
      name: text(author.name, 60),
      nameEn: text(author.nameEn, 60),
      role: text(author.role, 120),
      bio: multiline(author.bio, 500),
      avatar: text(author.avatar, 300) || '/images/avatar.svg',
    },
    location: text(raw.location, 100),
    email,
    github: github ? normalizeHttpUrl(github, 300) : '',
    socials: asArray(raw.socials, '社交链接', 12).map((social) => ({
      label: text(social?.label, 40),
      type: text(social?.type, 20),
      url: text(social?.url, 300),
      handle: text(social?.handle, 100),
    })),
    hero: {
      ...hero,
      eyebrow: text(hero.eyebrow, 120),
      issue: text(hero.issue, 60),
      title: text(hero.title, 60),
      titleEn: text(hero.titleEn, 120),
      description: multiline(hero.description, 600),
      primaryCta: {
        label: text(primaryCta.label, 40),
        url: text(primaryCta.url, 300) || '/posts/',
      },
      secondaryCta: {
        label: text(secondaryCta.label, 40),
        url: text(secondaryCta.url, 300) || '/resume/',
      },
      marquee: text(hero.marquee, 300),
    },
    home: {
      ...home,
      featuredLabel: text(home.featuredLabel, 80),
      latestTitle: text(home.latestTitle, 60),
      latestDescription: multiline(home.latestDescription, 300),
      topicsTitle: text(home.topicsTitle, 60),
      aboutTitle: text(home.aboutTitle, 60),
      aboutText: multiline(home.aboutText, 600),
    },
    pages: {
      ...pages,
      postsTitle: text(pages.postsTitle, 60),
      postsDescription: multiline(pages.postsDescription, 300),
      archivesTitle: text(pages.archivesTitle, 60),
      archivesDescription: multiline(pages.archivesDescription, 300),
      searchTitle: text(pages.searchTitle, 60),
      searchDescription: multiline(pages.searchDescription, 300),
      tagsTitle: text(pages.tagsTitle, 60),
      tagsDescription: multiline(pages.tagsDescription, 300),
    },
    commentsEnabled: Boolean(raw.commentsEnabled),
    commentApiBase: commentApiBase ? normalizeHttpUrl(commentApiBase, 300) : '',
    footerNote: text(raw.footerNote, 200),
    icp: text(raw.icp, 100),
  };

  if (!next.author.name) throw httpError(400, '作者名称不能为空。');
  if (JSON.stringify(next).length > 120000) throw httpError(400, '站点数据过大。');
  await writeJson(config.siteDataFile, next);
  return next;
}

export async function getResumeData() {
  return readJson(config.resumeDataFile, {});
}

export async function saveResumeData(input) {
  const raw = asObject(input, '简历数据');
  const email = text(raw.email, 160);
  if (email && !normalizeEmail(email)) throw httpError(400, '邮箱格式不正确。');
  const github = text(raw.github, 300);
  if (github && !normalizeHttpUrl(github, 300)) {
    throw httpError(400, 'GitHub 地址必须是有效的 http(s) 链接。');
  }

  const highlights = asArray(raw.highlights, '数据亮点', 12).map((item) => ({
    value: text(item?.value, 20),
    label: text(item?.label, 60),
  }));
  const experience = asArray(raw.experience, '工作经历', 30).map((item) => ({
    period: text(item?.period, 40),
    company: text(item?.company, 100),
    role: text(item?.role, 100),
    location: text(item?.location, 60),
    points: asArray(item?.points, '经历描述', 20).map((point) => text(point, 300)).filter(Boolean),
  }));
  const education = asArray(raw.education, '教育经历', 12).map((item) => ({
    period: text(item?.period, 40),
    school: text(item?.school, 120),
    detail: text(item?.detail, 200),
  }));
  const skills = asArray(raw.skills, '能力矩阵', 20).map((item) => ({
    group: text(item?.group, 60),
    items: asArray(item?.items, '能力标签', 30).map((tag) => text(tag, 60)).filter(Boolean),
  }));
  const languages = asArray(raw.languages, '语言能力', 12).map((item) => ({
    name: text(item?.name, 60),
    level: text(item?.level, 60),
  }));
  const now = asArray(raw.now, '正在关注', 12).map((item) => text(item, 200)).filter(Boolean);

  const next = {
    ...raw,
    name: text(raw.name, 60),
    nameEn: text(raw.nameEn, 60),
    title: text(raw.title, 120),
    location: text(raw.location, 100),
    email,
    github: github ? normalizeHttpUrl(github, 300) : '',
    website: text(raw.website, 300),
    status: text(raw.status, 120),
    summary: multiline(raw.summary, 1500),
    highlights,
    experience,
    education,
    skills,
    languages,
    now,
  };
  if (!next.name) throw httpError(400, '姓名不能为空。');
  if (JSON.stringify(next).length > 120000) throw httpError(400, '简历数据过大。');
  await writeJson(config.resumeDataFile, next);
  return next;
}

export async function getTagsOverview() {
  const descriptions = await getTagDescriptions();
  const usage = await countTags();
  const names = new Set([...Object.keys(descriptions || {}), ...usage.keys()]);
  return [...names]
    .filter(Boolean)
    .map((name) => ({
      name,
      description: descriptions?.[name]?.description || '',
      count: usage.get(name) || 0,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'));
}

export async function saveTagDescriptions(input) {
  const raw = asObject(input, '标签数据');
  const next = {};
  for (const [name, value] of Object.entries(raw)) {
    const key = text(name, 30);
    if (!key) continue;
    const description = multiline(value?.description, 300);
    next[key] = { description };
  }
  if (Object.keys(next).length > 100) throw httpError(400, '标签数量过多。');
  await writeJson(config.tagsDataFile, next);
  return getTagsOverview();
}

export async function renameTagEverywhere(from, to) {
  const oldName = text(from, 30);
  const newName = text(to, 30);
  if (!oldName || !newName) throw httpError(400, '标签名称不能为空。');
  if (oldName === newName) return { updated: 0 };
  if (newName.length > 20) throw httpError(400, '标签名不能超过 20 个字符。');

  const descriptions = await getTagDescriptions();
  if (descriptions[newName]) throw httpError(409, '目标标签已经存在，请直接使用或先删除。');
  const result = await renameTag(oldName, newName);
  if (descriptions[oldName]) {
    descriptions[newName] = descriptions[oldName];
    delete descriptions[oldName];
    await writeJson(config.tagsDataFile, descriptions);
  }
  return result;
}

export async function deleteTagEverywhere(name) {
  const target = text(name, 30);
  if (!target) throw httpError(400, '标签名称不能为空。');
  const result = await removeTag(target);
  const descriptions = await getTagDescriptions();
  if (descriptions[target]) {
    delete descriptions[target];
    await writeJson(config.tagsDataFile, descriptions);
  }
  return result;
}
