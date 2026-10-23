import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import multer from 'multer';
import MarkdownIt from 'markdown-it';
import { config, ensureRuntimeDirs } from './config.js';
import {
  ensureAuth,
  verifyPassword,
  setSessionCookie,
  clearSessionCookie,
  readSession,
  requireApiAuth,
  requirePreviewAuth,
  requireAdminRequest,
  changePassword,
  sessionInfo,
} from './auth.js';
import { httpError, asyncHandler, clientIp, hashValue, cleanText, createRateLimiter, relativeTime } from './util.js';
import {
  listPosts,
  getPost,
  createPost,
  updatePost,
  deletePost,
} from './posts.js';
import {
  getSiteData,
  saveSiteData,
  getResumeData,
  saveResumeData,
  getTagsOverview,
  saveTagDescriptions,
  renameTagEverywhere,
  deleteTagEverywhere,
} from './content.js';
import {
  initComments,
  listPublicComments,
  createComment,
  listAdminComments,
  commentCounts,
  updateCommentStatus,
  bulkUpdateStatus,
  deleteComment,
  migratePostKey,
  recentPending,
} from './comments.js';
import {
  initPreview,
  getPreviewState,
  scheduleBuild,
  rebuildNow,
} from './preview.js';
import {
  getGitStatus,
  getActionsStatus,
  getDeployState,
  getDeployHistory,
  deploy,
} from './deploy.js';

ensureRuntimeDirs();
await ensureAuth();
await initComments();
await initPreview();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

const loginLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 5, blockMs: 15 * 60 * 1000 });
const commentLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 4, blockMs: 10 * 60 * 1000 });

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

app.use(express.json({ limit: '512kb' }));

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  breaks: false,
});

const defaultLinkOpen = markdown.renderer.rules.link_open
  || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
markdown.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const href = tokens[idx].attrGet('href') || '';
  if (/^https?:\/\//i.test(href)) {
    tokens[idx].attrSet('target', '_blank');
    tokens[idx].attrSet('rel', 'noopener noreferrer');
  }
  return defaultLinkOpen(tokens, idx, options, env, self);
};

/* ---------- admin static shell ---------- */

app.use(
  express.static(config.adminDir, {
    index: false,
    maxAge: 0,
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
    },
  })
);

app.get('/', (req, res) => {
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "img-src 'self' data: https:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self'",
      "connect-src 'self'",
      "frame-src 'self'",
      "font-src 'self' data:",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'self'",
    ].join('; ')
  );
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(config.adminDir, 'index.html'));
});

/* ---------- preview ---------- */

let previewStaticCache = { release: null, handler: null };

app.use(
  '/preview',
  requirePreviewAuth,
  (req, res, next) => {
    const preview = getPreviewState();
    if (!preview.root) {
      res.status(503).type('html').send(
        '<!doctype html><meta charset="utf-8"><title>预览尚未生成</title>'
        + '<body style="background:#0b0b0a;color:#f1ece0;font:14px/1.8 system-ui;padding:48px">'
        + '<h1 style="font-size:20px">预览构建中</h1>'
        + '<p style="color:#8d8a7d">请稍后刷新。若持续失败，请在控制台查看构建错误。</p></body>'
      );
      return;
    }
    if (previewStaticCache.release !== preview.release) {
      previewStaticCache = {
        release: preview.release,
        handler: express.static(preview.root, {
          index: 'index.html',
          extensions: ['html'],
          setHeaders(response) {
            response.setHeader('Cache-Control', 'no-store');
          },
        }),
      };
    }
    previewStaticCache.handler(req, res, next);
  },
  async (req, res) => {
    const preview = getPreviewState();
    if (!preview.root) {
      res.status(404).send('Not found');
      return;
    }
    const notFound = path.join(preview.root, '404.html');
    try {
      const html = await fs.readFile(notFound, 'utf8');
      res.status(404).type('html').send(html);
    } catch {
      res.status(404).send('Not found');
    }
  }
);

/* ---------- auth ---------- */

app.get('/api/health', (req, res) => {
  res.json({ ok: true, now: new Date().toISOString() });
});

app.get('/api/auth/me', (req, res) => {
  const session = readSession(req);
  if (!session) {
    res.status(401).json({ error: '未登录。' });
    return;
  }
  res.json({
    authenticated: true,
    ...sessionInfo(),
    urls: {
      admin: config.adminPublicUrl,
      site: config.publicSiteUrl,
      preview: config.previewBaseUrl,
      github: `https://github.com/${config.githubRepo}`,
    },
  });
});

app.post(
  '/api/auth/login',
  asyncHandler(async (req, res) => {
    const ip = clientIp(req);
    const limit = loginLimiter.check(ip);
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfter));
      res.status(429).json({ error: `尝试次数过多，请 ${Math.ceil(limit.retryAfter / 60)} 分钟后重试。` });
      return;
    }
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!password) {
      res.status(400).json({ error: '请输入密码。' });
      return;
    }
    const ok = await verifyPassword(password);
    if (!ok) {
      await new Promise((resolve) => setTimeout(resolve, 350));
      res.status(401).json({ error: '密码不正确。' });
      return;
    }
    loginLimiter.reset(ip);
    setSessionCookie(req, res);
    res.json({ ok: true });
  })
);

app.post('/api/auth/logout', requireAdminRequest, (req, res) => {
  clearSessionCookie(req, res);
  res.json({ ok: true });
});

app.post(
  '/api/auth/password',
  requireApiAuth,
  requireAdminRequest,
  asyncHandler(async (req, res) => {
    await changePassword(req.body?.currentPassword, req.body?.newPassword);
    clearSessionCookie(req, res);
    res.json({ ok: true, relogin: true });
  })
);

/* ---------- admin api ---------- */

app.use('/api/admin', requireApiAuth, requireAdminRequest);

app.get(
  '/api/admin/overview',
  asyncHandler(async (req, res) => {
    const [posts, counts, pending, preview, deployState] = await Promise.all([
      listPosts(),
      Promise.resolve(commentCounts()),
      recentPending(5),
      Promise.resolve(getPreviewState()),
      getDeployState(),
    ]);
    let git = null;
    try {
      git = await getGitStatus();
    } catch (error) {
      git = { error: error.message };
    }
    const tags = await getTagsOverview();
    const now = new Date();
    res.json({
      stats: {
        posts: posts.length,
        published: posts.filter((post) => !post.draft).length,
        drafts: posts.filter((post) => post.draft).length,
        tags: tags.length,
        comments: counts,
      },
      recentPosts: posts.slice(0, 5).map((post) => ({
        id: post.id,
        title: post.title,
        date: post.date,
        draft: post.draft,
        tags: post.tags,
      })),
      pendingComments: pending.map((comment) => ({
        ...comment,
        relative: relativeTime(comment.created_at),
      })),
      preview,
      deploy: deployState,
      git,
      urls: {
        site: config.publicSiteUrl,
        preview: config.previewBaseUrl,
        github: `https://github.com/${config.githubRepo}`,
      },
      now: now.toISOString(),
    });
  })
);

app.get(
  '/api/admin/posts',
  asyncHandler(async (req, res) => {
    const posts = await listPosts();
    res.json({
      posts,
      counts: {
        all: posts.length,
        published: posts.filter((post) => !post.draft).length,
        drafts: posts.filter((post) => post.draft).length,
      },
    });
  })
);

app.post(
  '/api/admin/posts',
  asyncHandler(async (req, res) => {
    const post = await createPost(req.body || {});
    scheduleBuild(150);
    res.status(201).json({ post });
  })
);

app.get(
  '/api/admin/posts/:id',
  asyncHandler(async (req, res) => {
    res.json({ post: await getPost(req.params.id) });
  })
);

app.put(
  '/api/admin/posts/:id',
  asyncHandler(async (req, res) => {
    const previousId = req.params.id;
    const post = await updatePost(previousId, req.body || {});
    if (post.id !== previousId) {
      await migratePostKey(previousId, post.id, post.title);
    }
    scheduleBuild(150);
    res.json({ post });
  })
);

app.delete(
  '/api/admin/posts/:id',
  asyncHandler(async (req, res) => {
    const result = await deletePost(req.params.id);
    scheduleBuild(150);
    res.json({ ok: true, result });
  })
);

/* ---------- comments (admin) ---------- */

app.get(
  '/api/admin/comments',
  asyncHandler(async (req, res) => {
    const result = await listAdminComments({
      status: String(req.query.status || 'all'),
      post: String(req.query.post || ''),
      search: String(req.query.search || ''),
    });
    res.json({
      ...result,
      comments: result.comments.map((comment) => ({
        ...comment,
        relative: relativeTime(comment.created_at),
      })),
    });
  })
);

app.patch(
  '/api/admin/comments/:id',
  asyncHandler(async (req, res) => {
    const comment = await updateCommentStatus(req.params.id, String(req.body?.status || ''));
    res.json({ ok: true, comment });
  })
);

app.post(
  '/api/admin/comments/bulk',
  asyncHandler(async (req, res) => {
    const result = await bulkUpdateStatus(req.body?.ids, String(req.body?.status || ''));
    res.json({ ok: true, ...result });
  })
);

app.delete(
  '/api/admin/comments/:id',
  asyncHandler(async (req, res) => {
    await deleteComment(req.params.id);
    res.json({ ok: true });
  })
);

/* ---------- site / resume / tags ---------- */

app.get(
  '/api/admin/site',
  asyncHandler(async (req, res) => {
    res.json({ site: await getSiteData() });
  })
);

app.put(
  '/api/admin/site',
  asyncHandler(async (req, res) => {
    const site = await saveSiteData(req.body || {});
    scheduleBuild(150);
    res.json({ site });
  })
);

app.get(
  '/api/admin/resume',
  asyncHandler(async (req, res) => {
    res.json({ resume: await getResumeData() });
  })
);

app.put(
  '/api/admin/resume',
  asyncHandler(async (req, res) => {
    const resume = await saveResumeData(req.body || {});
    scheduleBuild(150);
    res.json({ resume });
  })
);

app.get(
  '/api/admin/tags',
  asyncHandler(async (req, res) => {
    res.json({ tags: await getTagsOverview() });
  })
);

app.put(
  '/api/admin/tags',
  asyncHandler(async (req, res) => {
    const tags = await saveTagDescriptions(req.body || {});
    scheduleBuild(150);
    res.json({ tags });
  })
);

app.post(
  '/api/admin/tags/rename',
  asyncHandler(async (req, res) => {
    const result = await renameTagEverywhere(req.body?.from, req.body?.to);
    scheduleBuild(150);
    res.json({ ok: true, ...result, tags: await getTagsOverview() });
  })
);

app.post(
  '/api/admin/tags/delete',
  asyncHandler(async (req, res) => {
    const result = await deleteTagEverywhere(req.body?.name);
    scheduleBuild(150);
    res.json({ ok: true, ...result, tags: await getTagsOverview() });
  })
);

/* ---------- uploads ---------- */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.uploadMaxBytes, files: 1 },
  fileFilter(req, file, callback) {
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.mimetype)) {
      callback(httpError(400, '仅支持 PNG、JPEG、GIF、WebP 图片。'));
      return;
    }
    callback(null, true);
  },
});

function detectImage(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpg';
  }
  if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))) {
    return 'gif';
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'webp';
  }
  return null;
}

app.post(
  '/api/admin/upload',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw httpError(400, '没有收到文件。');
    const extension = detectImage(req.file.buffer);
    if (!extension) throw httpError(400, '图片文件内容无法识别。');
    const now = new Date();
    const parts = new Intl.DateTimeFormat('sv-SE', {
      timeZone: config.timeZone,
      year: 'numeric',
      month: '2-digit',
    }).format(now).split('-');
    const relativeDir = path.posix.join(parts[0], parts[1]);
    const filename = `${crypto.randomBytes(8).toString('hex')}.${extension}`;
    const targetDir = path.join(config.uploadsDir, parts[0], parts[1]);
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(path.join(targetDir, filename), req.file.buffer, { flag: 'wx' });
    const url = `/uploads/${relativeDir}/${filename}`;
    scheduleBuild(300);
    res.status(201).json({
      ok: true,
      url,
      size: req.file.size,
      type: extension,
    });
  })
);

/* ---------- markdown render ---------- */

app.post(
  '/api/admin/markdown',
  asyncHandler(async (req, res) => {
    const source = cleanText(req.body?.markdown, 300000);
    res.json({ html: markdown.render(source) });
  })
);

/* ---------- preview controls ---------- */

app.get('/api/admin/preview/status', (req, res) => {
  res.json({ preview: getPreviewState() });
});

app.post(
  '/api/admin/preview/rebuild',
  asyncHandler(async (req, res) => {
    await rebuildNow();
    res.json({ preview: getPreviewState() });
  })
);

/* ---------- deploy ---------- */

app.get(
  '/api/admin/deploy/status',
  asyncHandler(async (req, res) => {
    let git = null;
    try {
      git = await getGitStatus();
    } catch (error) {
      git = { error: error.message };
    }
    const [actions, history, state] = await Promise.all([
      getActionsStatus(),
      getDeployHistory(),
      getDeployState(),
    ]);
    res.json({
      git,
      actions,
      state,
      history: history.slice(0, 10),
      preview: getPreviewState(),
      urls: {
        site: config.publicSiteUrl,
        github: `https://github.com/${config.githubRepo}`,
        actions: `https://github.com/${config.githubRepo}/actions`,
        preview: config.previewBaseUrl,
      },
    });
  })
);

app.post(
  '/api/admin/deploy',
  asyncHandler(async (req, res) => {
    const result = await deploy({ message: req.body?.message });
    res.json({ ok: true, result });
  })
);

/* ---------- public comments ---------- */

app.use('/api/public', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  res.setHeader('Access-Control-Max-Age', '600');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

app.get(
  '/api/public/comments',
  asyncHandler(async (req, res) => {
    const comments = await listPublicComments(String(req.query.post || ''));
    res.json({ comments, count: comments.length });
  })
);

app.post(
  '/api/public/comments',
  asyncHandler(async (req, res) => {
    if (!req.is('application/json')) {
      res.status(415).json({ error: '仅接受 JSON 请求。' });
      return;
    }
    const ip = clientIp(req);
    const limit = commentLimiter.check(ip);
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfter));
      res.status(429).json({ error: '发送太频繁，请稍后再试。' });
      return;
    }

    const body = req.body || {};
    const result = await createComment(body, {
      ipHash: hashValue(ip, config.sessionSecret),
      userAgent: req.get('user-agent') || '',
    });

    res.status(201).json({
      ok: true,
      message: '评论已提交，审核通过后会显示。',
      id: result.comment?.id,
    });
  })
);

/* ---------- fallbacks ---------- */

app.use('/api', (req, res) => {
  res.status(404).json({ error: '接口不存在。' });
});

app.use((req, res) => {
  res.redirect('/');
});

app.use((error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  const status = error.status || (error.code === 'LIMIT_FILE_SIZE' ? 400 : 500);
  const message = error.code === 'LIMIT_FILE_SIZE'
    ? '文件超过 8MB 限制。'
    : (error.status ? error.message : '服务器内部错误。');
  if (status >= 500) console.error('[server]', error);
  res.status(status).json({ error: message });
});

const server = app.listen(config.port, config.host, () => {
  console.log(`[server] 控制台已启动 http://${config.host}:${config.port}`);
  console.log(`[server] 仓库：${config.repoDir}`);
  console.log(`[server] 预览：${config.previewBaseUrl}`);
});

function shutdown(signal) {
  console.log(`[server] 收到 ${signal}，正在关闭…`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
