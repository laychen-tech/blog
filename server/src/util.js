import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export const asyncHandler = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

export async function readJson(file, fallback) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    if (error instanceof SyntaxError) {
      throw httpError(500, `数据文件格式损坏：${path.basename(file)}`);
    }
    throw error;
  }
}

export async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  const content = `${JSON.stringify(value, null, 2)}\n`;
  await fs.writeFile(temporary, content, { encoding: 'utf8', mode: 0o640 });
  try {
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

export async function readText(file, fallback = null) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

export async function writeTextAtomic(file, value, mode = 0o640) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fs.writeFile(temporary, value, { encoding: 'utf8', mode });
  await fs.rename(temporary, file);
}

export function parseCookies(header = '') {
  const cookies = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    if (!name) continue;
    const value = part.slice(index + 1).trim();
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
  }
  return cookies;
}

export function cleanText(value, maxLength) {
  if (typeof value !== 'string') return '';
  const cleaned = value.replace(/\u0000/g, '').replace(/\r\n/g, '\n').trim();
  return maxLength ? cleaned.slice(0, maxLength) : cleaned;
}

export function cleanSingleLine(value, maxLength) {
  return cleanText(value, maxLength).replace(/\s+/g, ' ').trim();
}

export function toBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return fallback;
}

export function normalizeHttpUrl(value, maxLength = 300) {
  const text = cleanSingleLine(value, maxLength);
  if (!text) return '';
  try {
    const url = new URL(text);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.toString();
  } catch {
    return '';
  }
}

export function normalizeEmail(value) {
  const text = cleanSingleLine(value, 160);
  if (!text) return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(text)) return '';
  return text;
}

export function hashValue(value, secret) {
  return crypto.createHmac('sha256', secret).update(String(value)).digest('hex').slice(0, 32);
}

export function safeEqualText(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function formatDateTime(value = new Date(), timeZone = 'Asia/Shanghai') {
  const date = value instanceof Date ? value : new Date(value);
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
  return `${lookup.year}-${lookup.month}-${lookup.day} ${lookup.hour}:${lookup.minute}`;
}

export function normalizePostDate(value) {
  const text = cleanSingleLine(value, 40);
  if (!text) return new Date().toISOString();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${text}T00:00:00+08:00`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)) return `${text}:00+08:00`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(text)) return `${text}+08:00`;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
}

export function toDateTimeLocal(value) {
  if (!value) return '';
  const text = String(value);
  const match = text.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
  if (match) return `${match[1]}T${match[2]}`;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
  return parts.replace(' ', 'T');
}

export function stripMarkdown(markdown) {
  return String(markdown || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function excerptFromMarkdown(markdown, maxLength = 120) {
  const text = stripMarkdown(markdown);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trim()}…`;
}

export function countWords(markdown) {
  const text = stripMarkdown(markdown);
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const words = text.replace(/[\u4e00-\u9fff]/g, ' ').trim().split(/\s+/).filter(Boolean).length;
  return cjk + words;
}

export function slugify(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function isValidPostId(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 80
    && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
    && value !== '_index';
}

export function generatePostId() {
  const now = new Date();
  const stamp = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now).replace(/-/g, '');
  const suffix = crypto.randomBytes(3).toString('hex').slice(0, 4);
  return `post-${stamp}-${suffix}`;
}

export function createRateLimiter({ windowMs, max, blockMs = windowMs }) {
  const buckets = new Map();

  const sweep = () => {
    const now = Date.now();
    for (const [key, entry] of buckets) {
      if (entry.blockedUntil < now && now - entry.startedAt > windowMs) {
        buckets.delete(key);
      }
    }
  };

  const timer = setInterval(sweep, 10 * 60 * 1000);
  timer.unref?.();

  return {
    check(key) {
      const now = Date.now();
      let entry = buckets.get(key);
      if (!entry || now - entry.startedAt > windowMs) {
        entry = { count: 0, startedAt: now, blockedUntil: 0 };
        buckets.set(key, entry);
      }
      if (entry.blockedUntil > now) {
        return { allowed: false, retryAfter: Math.ceil((entry.blockedUntil - now) / 1000) };
      }
      entry.count += 1;
      if (entry.count > max) {
        entry.blockedUntil = now + blockMs;
        return { allowed: false, retryAfter: Math.ceil(blockMs / 1000) };
      }
      return { allowed: true, remaining: max - entry.count };
    },
    reset(key) {
      buckets.delete(key);
    },
  };
}

export function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

export function relativeTime(value, now = Date.now()) {
  const date = new Date(value).getTime();
  if (Number.isNaN(date)) return '';
  const diff = Math.round((date - now) / 1000);
  const formatter = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' });
  const units = [
    ['year', 31536000],
    ['month', 2592000],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];
  for (const [unit, seconds] of units) {
    if (Math.abs(diff) >= seconds) return formatter.format(Math.round(diff / seconds), unit);
  }
  return '刚刚';
}
