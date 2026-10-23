import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { config } from './config.js';
import {
  httpError,
  parseCookies,
  readJson,
  writeJson,
  safeEqualText,
} from './util.js';

const scryptAsync = promisify(crypto.scrypt);
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LENGTH = 64;

let authState = null;

async function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = await scryptAsync(password, salt, KEY_LENGTH, SCRYPT_OPTIONS);
  return { salt, hash: derived.toString('hex') };
}

export async function ensureAuth() {
  const stored = await readJson(config.authFile, null);
  if (stored && stored.hash && stored.salt) {
    authState = stored;
    return;
  }

  const initial = config.adminInitialPassword;
  if (!initial || initial.length < 8) {
    throw new Error(
      '首次启动需要设置 ADMIN_INITIAL_PASSWORD（至少 8 位），或在 server/.env 中提供该变量。'
    );
  }

  const { salt, hash } = await hashPassword(initial);
  authState = {
    version: 1,
    salt,
    hash,
    sessionVersion: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await writeJson(config.authFile, authState);
}

export async function verifyPassword(password) {
  if (!authState) await ensureAuth();
  if (typeof password !== 'string' || password.length === 0 || password.length > 200) return false;
  const derived = await scryptAsync(password, authState.salt, KEY_LENGTH, SCRYPT_OPTIONS);
  const expected = Buffer.from(authState.hash, 'hex');
  if (expected.length !== derived.length) return false;
  return crypto.timingSafeEqual(expected, derived);
}

function sign(value) {
  return crypto.createHmac('sha256', config.sessionSecret).update(value).digest('base64url');
}

export function createSessionToken() {
  const payload = {
    role: 'admin',
    v: authState?.sessionVersion || 1,
    iat: Date.now(),
    exp: Date.now() + config.sessionMaxAgeMs,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${encoded}.${sign(encoded)}`;
}

export function verifySessionToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;
  if (!safeEqualText(signature, sign(encoded))) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (payload.role !== 'admin') return null;
    if (!payload.exp || payload.exp < Date.now()) return null;
    if (payload.v !== (authState?.sessionVersion || 1)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function readSession(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  return verifySessionToken(cookies[config.sessionCookie]);
}

function cookieOptions(req) {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: Boolean(req.secure),
    path: '/',
  };
}

export function setSessionCookie(req, res) {
  res.cookie(config.sessionCookie, createSessionToken(), {
    ...cookieOptions(req),
    maxAge: config.sessionMaxAgeMs,
  });
}

export function clearSessionCookie(req, res) {
  res.clearCookie(config.sessionCookie, cookieOptions(req));
}

export function requireApiAuth(req, res, next) {
  const session = readSession(req);
  if (!session) {
    res.status(401).json({ error: '登录已过期，请重新登录。' });
    return;
  }
  req.session = session;
  next();
}

export function requirePreviewAuth(req, res, next) {
  const session = readSession(req);
  if (!session) {
    res.status(401).send(
      '<!doctype html><meta charset="utf-8"><title>需要登录</title>'
      + '<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0b0a;color:#f1ece0;font:14px/1.7 system-ui,sans-serif}'
      + 'a{color:#f14b1e}</style>'
      + '<div><p>预览区需要登录控制台。</p><p><a href="/" target="_top">前往登录</a></p></div>'
    );
    return;
  }
  next();
}

export function requireAdminRequest(req, res, next) {
  if (req.get('x-requested-with') !== 'ai-blog-admin') {
    res.status(403).json({ error: '缺少管理端请求标识。' });
    return;
  }
  const origin = req.get('origin');
  if (origin) {
    try {
      const originHost = new URL(origin).host;
      if (originHost !== req.get('host')) {
        res.status(403).json({ error: '请求来源不受信任。' });
        return;
      }
    } catch {
      res.status(403).json({ error: '请求来源无效。' });
      return;
    }
  }
  next();
}

export async function setPasswordDirect(nextPassword) {
  if (typeof nextPassword !== 'string' || nextPassword.length < 10 || nextPassword.length > 200) {
    throw httpError(400, '新密码至少 10 位，最多 200 位。');
  }
  if (!authState) {
    const stored = await readJson(config.authFile, null);
    authState = stored && stored.hash && stored.salt
      ? stored
      : { version: 1, sessionVersion: 0, createdAt: new Date().toISOString() };
  }
  const { salt, hash } = await hashPassword(nextPassword);
  authState = {
    ...authState,
    salt,
    hash,
    sessionVersion: (authState.sessionVersion || 1) + 1,
    updatedAt: new Date().toISOString(),
  };
  await writeJson(config.authFile, authState);
}

export async function changePassword(currentPassword, nextPassword) {
  if (!authState) await ensureAuth();
  if (!(await verifyPassword(currentPassword))) {
    throw httpError(400, '当前密码不正确。');
  }
  if (nextPassword === currentPassword) {
    throw httpError(400, '新密码不能与当前密码相同。');
  }
  await setPasswordDirect(nextPassword);
}

export function sessionInfo() {
  return {
    role: 'admin',
    sessionVersion: authState?.sessionVersion || 1,
    passwordUpdatedAt: authState?.updatedAt || null,
  };
}
