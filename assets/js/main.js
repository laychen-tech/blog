(() => {
  'use strict';

  const docEl = document.documentElement;
  const body = document.body;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- theme ---------- */

  const themeButtons = document.querySelectorAll('[data-theme-toggle]');
  const syncThemeButtons = () => {
    const isDark = docEl.getAttribute('data-theme') === 'dark';
    themeButtons.forEach((button) => {
      button.setAttribute('aria-label', isDark ? '切换到浅色模式' : '切换到深色模式');
      button.setAttribute('title', isDark ? '切换到浅色模式' : '切换到深色模式');
    });
  };

  themeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const next = docEl.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      docEl.setAttribute('data-theme', next);
      try {
        localStorage.setItem('air-theme', next);
      } catch (error) {
        /* storage can be unavailable */
      }
      syncThemeButtons();
    });
  });
  syncThemeButtons();

  /* ---------- mobile navigation ---------- */

  const menuToggle = document.querySelector('[data-menu-toggle]');
  const mobileNav = document.querySelector('[data-mobile-nav]');

  const closeMenu = () => {
    body.classList.remove('nav-open');
    if (menuToggle) menuToggle.setAttribute('aria-expanded', 'false');
  };

  if (menuToggle && mobileNav) {
    menuToggle.addEventListener('click', () => {
      const open = body.classList.toggle('nav-open');
      menuToggle.setAttribute('aria-expanded', String(open));
    });

    mobileNav.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', closeMenu);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && body.classList.contains('nav-open')) closeMenu();
    });

    window.addEventListener('resize', () => {
      if (window.innerWidth > 960) closeMenu();
    });
  }

  /* ---------- scroll progress ---------- */

  const scrollLine = document.querySelector('[data-scroll-line]');
  const readProgress = document.querySelector('[data-read-progress]');
  let ticking = false;

  const updateProgress = () => {
    const scrollTop = window.scrollY || window.pageYOffset;
    const docHeight = docEl.scrollHeight - window.innerHeight;
    const ratio = docHeight > 0 ? Math.min(1, Math.max(0, scrollTop / docHeight)) : 0;
    if (scrollLine) scrollLine.style.width = `${ratio * 100}%`;
    if (readProgress) readProgress.style.width = `${ratio * 100}%`;
    ticking = false;
  };

  const onScroll = () => {
    if (!ticking) {
      window.requestAnimationFrame(updateProgress);
      ticking = true;
    }
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  updateProgress();

  /* ---------- reveal on scroll ---------- */

  const revealItems = document.querySelectorAll('[data-reveal]');
  if (!reduceMotion && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.08, rootMargin: '0px 0px -8% 0px' }
    );

    revealItems.forEach((item) => {
      item.classList.add('will-reveal');
      observer.observe(item);
    });
  }

  /* ---------- clipboard helpers ---------- */

  const writeClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch (err) {
        ok = false;
      }
      area.remove();
      return ok;
    }
  };

  document.querySelectorAll('[data-copy-url]').forEach((button) => {
    button.addEventListener('click', async () => {
      const original = button.innerHTML;
      const ok = await writeClipboard(button.dataset.copyUrl);
      button.textContent = ok ? '链接已复制' : '复制失败';
      window.setTimeout(() => {
        button.innerHTML = original;
      }, 1800);
    });
  });

  document.querySelectorAll('.post-content pre').forEach((pre) => {
    const host = pre.parentElement && pre.parentElement.classList.contains('highlight')
      ? pre.parentElement
      : pre;
    if (host.querySelector('.code-copy')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'code-copy';
    button.textContent = 'COPY';
    button.addEventListener('click', async () => {
      const code = pre.querySelector('code');
      const text = code ? code.innerText : pre.innerText;
      const ok = await writeClipboard(text);
      button.textContent = ok ? 'COPIED' : 'FAILED';
      window.setTimeout(() => {
        button.textContent = 'COPY';
      }, 1600);
    });
    if (host !== pre) host.style.position = 'relative';
    host.appendChild(button);
  });

  /* ---------- table of contents active state ---------- */

  const tocLinks = Array.from(document.querySelectorAll('.post-toc a[href^="#"]'));
  if (tocLinks.length) {
    const headings = tocLinks
      .map((link) => {
        const id = decodeURIComponent(link.getAttribute('href').slice(1));
        const heading = document.getElementById(id);
        return heading ? { heading, link } : null;
      })
      .filter(Boolean);

    let tocTicking = false;
    const updateToc = () => {
      let current = null;
      const threshold = 160;
      headings.forEach((item) => {
        if (item.heading.getBoundingClientRect().top <= threshold) current = item;
      });
      tocLinks.forEach((link) => link.classList.remove('is-current'));
      if (current) current.link.classList.add('is-current');
      tocTicking = false;
    };

    window.addEventListener(
      'scroll',
      () => {
        if (!tocTicking) {
          window.requestAnimationFrame(updateToc);
          tocTicking = true;
        }
      },
      { passive: true }
    );
    updateToc();
  }

  /* ---------- print ---------- */

  document.querySelectorAll('[data-print]').forEach((button) => {
    button.addEventListener('click', () => window.print());
  });

  /* ---------- search ---------- */

  const searchRoot = document.querySelector('[data-search]');
  if (searchRoot) {
    const input = searchRoot.querySelector('[data-search-input]');
    const resultsRoot = document.querySelector('[data-search-results]');
    const meta = document.querySelector('[data-search-meta]');
    const indexUrl = searchRoot.dataset.indexUrl;
    let indexData = null;
    let loading = false;
    let timer = null;

    const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const highlightText = (text, query) => {
      const fragment = document.createDocumentFragment();
      if (!query) {
        fragment.appendChild(document.createTextNode(text));
        return fragment;
      }
      const regex = new RegExp(`(${escapeRegExp(query)})`, 'gi');
      const parts = text.split(regex);
      parts.forEach((part, i) => {
        if (!part) return;
        if (i % 2 === 1) {
          const mark = document.createElement('mark');
          mark.textContent = part;
          fragment.appendChild(mark);
        } else {
          fragment.appendChild(document.createTextNode(part));
        }
      });
      return fragment;
    };

    const makeResult = (item, query) => {
      const link = document.createElement('a');
      link.className = 'search-result';
      link.href = item.url;

      const date = document.createElement('span');
      date.className = 'search-result-date';
      date.textContent = item.date;

      const main = document.createElement('span');
      const title = document.createElement('span');
      title.className = 'search-result-title';
      title.appendChild(highlightText(item.title, query));
      main.appendChild(title);

      const summary = document.createElement('span');
      summary.className = 'search-result-summary';
      summary.appendChild(highlightText(item.summary || '', query));
      main.appendChild(summary);

      if (item.tags && item.tags.length) {
        const tags = document.createElement('span');
        tags.className = 'search-result-tags';
        item.tags.forEach((tag) => {
          const tagEl = document.createElement('span');
          tagEl.textContent = `#${tag}`;
          tags.appendChild(tagEl);
        });
        main.appendChild(tags);
      }

      const arrow = document.createElement('span');
      arrow.className = 'search-result-arrow';
      arrow.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M7 17 17 7M8 7h9v9"/></svg>';

      link.appendChild(date);
      link.appendChild(main);
      link.appendChild(arrow);
      return link;
    };

    const renderEmpty = (text) => {
      const empty = document.createElement('div');
      empty.className = 'search-empty';
      empty.textContent = text;
      const sub = document.createElement('span');
      sub.className = 'mono';
      sub.textContent = 'NO SIGNAL FOUND';
      empty.appendChild(sub);
      resultsRoot.replaceChildren(empty);
    };

    const search = (rawQuery) => {
      if (!indexData) return;
      const query = rawQuery.trim();
      resultsRoot.replaceChildren();
      if (!query) {
        meta.textContent = `${indexData.length} 篇文章已索引 / 输入关键词开始检索`;
        renderEmpty('输入一个关键词，开始检索。');
        return;
      }

      const lower = query.toLowerCase();
      const scored = indexData
        .map((item) => {
          let score = 0;
          const title = (item.title || '').toLowerCase();
          const summary = (item.summary || '').toLowerCase();
          const content = (item.content || '').toLowerCase();
          const tags = (item.tags || []).join(' ').toLowerCase();
          if (title.includes(lower)) score += 10;
          if (tags.includes(lower)) score += 6;
          if (summary.includes(lower)) score += 4;
          if (content.includes(lower)) score += 1;
          return { item, score };
        })
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 20);

      meta.textContent = `${scored.length} 条结果 / QUERY: ${query}`;

      if (!scored.length) {
        renderEmpty(`没有找到与“${query}”相关的内容。`);
        return;
      }

      const fragment = document.createDocumentFragment();
      scored.forEach(({ item }) => fragment.appendChild(makeResult(item, query)));
      resultsRoot.appendChild(fragment);
    };

    const loadIndex = async () => {
      if (indexData || loading) return;
      loading = true;
      meta.textContent = '正在建立索引…';
      try {
        const response = await fetch(indexUrl, { headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        indexData = await response.json();
        loading = false;
        search(input.value);
      } catch (error) {
        loading = false;
        meta.textContent = '索引加载失败';
        renderEmpty('检索暂时不可用，请稍后刷新页面。');
      }
    };

    const queueSearch = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => loadIndex().then(() => search(input.value)), 120);
    };

    input.addEventListener('input', queueSearch);
    input.addEventListener('focus', loadIndex, { once: true });

    searchRoot.querySelectorAll('[data-search-suggest]').forEach((button) => {
      button.addEventListener('click', () => {
        input.value = button.dataset.searchSuggest;
        loadIndex().then(() => search(input.value));
        input.focus();
      });
    });

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        input.value = '';
        search('');
        input.blur();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === '/' && document.activeElement !== input && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
        event.preventDefault();
        input.focus();
        loadIndex();
      }
    });

    const initialQuery = new URLSearchParams(window.location.search).get('q');
    if (initialQuery) {
      input.value = initialQuery;
      loadIndex().then(() => search(initialQuery));
    }
  }

  /* ---------- comments ---------- */

  const commentRoot = document.querySelector('[data-comments]');
  if (commentRoot) {
    const postId = commentRoot.dataset.post;
    const apiBase = (commentRoot.dataset.apiBase || '').replace(/\/$/, '');
    const list = commentRoot.querySelector('[data-comments-list]');
    const countEl = commentRoot.querySelector('[data-comments-count]');
    const form = commentRoot.querySelector('[data-comment-form]');
    const statusEl = commentRoot.querySelector('[data-comment-status]');

    const formatDate = (value) => {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '';
      return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    };

    const renderComment = (comment) => {
      const article = document.createElement('article');
      article.className = 'comment';

      const avatar = document.createElement('span');
      avatar.className = 'comment-avatar';
      avatar.setAttribute('aria-hidden', 'true');
      const initial = (comment.author || '?').trim().charAt(0).toUpperCase();
      avatar.textContent = initial;
      let hash = 0;
      for (const char of comment.author || '') hash = (hash * 31 + char.codePointAt(0)) % 360;
      avatar.style.background = `hsl(${hash}, 48%, 22%)`;
      avatar.style.color = '#f4f0e6';

      const content = document.createElement('div');
      const head = document.createElement('div');
      head.className = 'comment-head';
      const author = document.createElement('span');
      author.className = 'comment-author';
      author.textContent = comment.author || '匿名';
      const date = document.createElement('time');
      date.className = 'comment-date';
      date.dateTime = comment.created_at || '';
      date.textContent = formatDate(comment.created_at);
      head.appendChild(author);
      head.appendChild(date);

      const bodyCopy = document.createElement('p');
      bodyCopy.className = 'comment-body';
      bodyCopy.textContent = comment.content || '';

      content.appendChild(head);
      content.appendChild(bodyCopy);

      if (comment.website) {
        try {
          const url = new URL(comment.website);
          if (url.protocol === 'http:' || url.protocol === 'https:') {
            const site = document.createElement('a');
            site.className = 'comment-site';
            site.href = url.href;
            site.target = '_blank';
            site.rel = 'nofollow noopener noreferrer ugc';
            site.textContent = url.hostname;
            site.insertAdjacentHTML('beforeend', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M7 17 17 7M8 7h9v9"/></svg>');
            content.appendChild(site);
          }
        } catch (error) {
          /* ignore invalid stored urls */
        }
      }

      article.appendChild(avatar);
      article.appendChild(content);
      return article;
    };

    const renderEmpty = (text) => {
      const empty = document.createElement('div');
      empty.className = 'comment-empty';
      empty.textContent = text;
      list.replaceChildren(empty);
    };

    const loadComments = async () => {
      try {
        const response = await fetch(
          `${apiBase}/api/public/comments?post=${encodeURIComponent(postId)}`,
          { headers: { Accept: 'application/json' } }
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const comments = Array.isArray(data.comments) ? data.comments : [];
        if (countEl) countEl.textContent = String(comments.length);
        if (!comments.length) {
          renderEmpty('还没有评论。成为第一个留下信号的人。');
          return;
        }
        list.replaceChildren();
        comments.forEach((comment) => list.appendChild(renderComment(comment)));
      } catch (error) {
        if (countEl) countEl.textContent = '';
        renderEmpty('评论区暂时离线，请稍后刷新。');
      }
    };

    if (form) {
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (statusEl) {
          statusEl.textContent = '';
          statusEl.classList.remove('is-error', 'is-success');
        }

        const data = new FormData(form);
        const payload = {
          post: postId,
          author: String(data.get('author') || '').trim(),
          email: String(data.get('email') || '').trim(),
          website: String(data.get('website') || '').trim(),
          content: String(data.get('content') || '').trim(),
          website_url: String(data.get('website_url') || ''),
        };

        if (!payload.author || payload.author.length > 40) {
          if (statusEl) {
            statusEl.textContent = '请填写 1–40 个字符的称呼。';
            statusEl.classList.add('is-error');
          }
          return;
        }
        if (payload.content.length < 2 || payload.content.length > 2000) {
          if (statusEl) {
            statusEl.textContent = '评论内容需为 2–2000 个字符。';
            statusEl.classList.add('is-error');
          }
          return;
        }

        const submitButton = form.querySelector('button[type="submit"]');
        if (submitButton) {
          submitButton.disabled = true;
          submitButton.dataset.idleLabel = submitButton.innerHTML;
          submitButton.textContent = '发送中…';
        }

        try {
          const response = await fetch(`${apiBase}/api/public/comments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(payload),
          });
          const result = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(result.error || '发送失败，请稍后重试。');
          }
          if (statusEl) {
            statusEl.textContent = '评论已发送。审核通过后会出现在这里。';
            statusEl.classList.add('is-success');
          }
          form.querySelector('[name="content"]').value = '';
          form.querySelector('[name="website_url"]').value = '';
        } catch (error) {
          if (statusEl) {
            statusEl.textContent = error.message || '发送失败，请稍后重试。';
            statusEl.classList.add('is-error');
          }
        } finally {
          if (submitButton) {
            submitButton.disabled = false;
            submitButton.innerHTML = submitButton.dataset.idleLabel || '发送评论';
          }
        }
      });
    }

    loadComments();
  }
})();
