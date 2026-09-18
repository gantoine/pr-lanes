(function (root) {
  'use strict';

  const DEFAULT_BOT_LOGINS = [
    'allcontributors',
    'argos-ci',
    'bundlemon',
    'changeset-bot',
    'chromatic',
    'claude',
    'codecov',
    'codecov-commenter',
    'codspeed-hq',
    'coderabbitai',
    'copilot',
    'copilot-pull-request-reviewer',
    'cursor',
    'danger',
    'deepsource-autofix',
    'dependabot',
    'depot',
    'devin-ai-integration',
    'ellipsis-dev',
    'github-actions',
    'github-advanced-security',
    'graphite-app',
    'greptile',
    'greptile-apps',
    'imgbot',
    'lighthouse-ci',
    'max-ai',
    'mergify',
    'netlify',
    'percy',
    'posthog-bot',
    'pre-commit-ci',
    'renovate',
    'semantic-release-bot',
    'sentry-io',
    'size-limit',
    'snyk-bot',
    'socket-security',
    'sonarcloud',
    'sonarqubecloud',
    'sourcery-ai',
    'stale',
    'trunk-io',
    'vercel'
  ];

  const HEURISTIC_PATTERNS = [
    /(^|[-_.])bots?$/i,
    /^bot[-_.]/i,
    /(^|[-_.])(ci|cd|deploy|build)-?bot$/i,
    /(^|[-_.])(app|action|actions)$/i
  ];

  const COMMENT_SELECTOR = [
    '.timeline-comment',
    '.js-comment-container',
    '.review-comment',
    '[data-testid="issue-body"]',
    '[data-testid="comment-viewer-outer-box"]',
    '[data-testid="issue-comment"]',
    '[data-testid="pr-review-comment"]'
  ].join(',');

  const AUTHOR_SELECTOR = [
    'a.author',
    '.author',
    '[data-testid="avatar-link"]',
    '[data-testid="issue-body-header-author"]',
    '[data-testid="comment-header-author"]',
    '[data-testid="author-link"]'
  ].join(',');

  const AVATAR_SELECTOR = [
    'img.avatar',
    'img.avatar-user',
    'img[data-component="Avatar"]',
    'img[class*="avatar" i]',
    'img[src*="avatars."]'
  ].join(',');

  const HEADER_SELECTOR = [
    '.timeline-comment-header',
    '.review-comment-header',
    '[data-testid="comment-header"]',
    '[data-testid="issue-body-header"]'
  ].join(',');

  const ALWAYS_PIN_SELECTOR = [
    '.merge-pr',
    '.merge-message',
    '.discussion-timeline-actions',
    '[data-testid="merge-box"]'
  ].join(',');

  const COMPOSER_SELECTOR = [
    'textarea',
    '[data-testid="comment-composer"]',
    '[data-testid="markdown-editor"]'
  ].join(',');

  function normalizeLogin(value) {
    return String(value == null ? '' : value)
      .trim()
      .replace(/^@/, '')
      .replace(/\[bot\]$/i, '')
      .toLowerCase();
  }

  function parseLoginList(value) {
    if (Array.isArray(value)) return value.map(normalizeLogin).filter(Boolean);
    return String(value == null ? '' : value)
      .split(/[\s,]+/)
      .map(normalizeLogin)
      .filter(Boolean);
  }

  function buildRules(settings) {
    const options = settings || {};
    return {
      bots: new Set(DEFAULT_BOT_LOGINS.concat(parseLoginList(options.extraBots))),
      humans: new Set(parseLoginList(options.forceHumans)),
      heuristics: options.heuristics !== false
    };
  }

  function classifyAuthor(author, rules) {
    const login = normalizeLogin(author && author.login);
    if (login && rules.humans.has(login)) return 'human';
    if (author && author.suffixedBot) return 'bot';
    if (login && rules.bots.has(login)) return 'bot';
    if (author && author.appAvatar) return 'bot';
    if (author && author.botBadge) return 'bot';
    if (login && rules.heuristics && HEURISTIC_PATTERNS.some((pattern) => pattern.test(login))) return 'bot';
    return 'human';
  }

  function loginFromHref(href) {
    if (!href) return '';
    try {
      const path = new URL(href, 'https://github.com').pathname;
      const match = path.match(/^\/([^/?#]+)\/?$/);
      return match ? decodeURIComponent(match[1]) : '';
    } catch (error) {
      return '';
    }
  }

  function readAuthor(element) {
    const header = element.querySelector(HEADER_SELECTOR) || element;
    const scope = header === element ? element : header;
    const link = scope.querySelector(AUTHOR_SELECTOR) || element.querySelector(AUTHOR_SELECTOR);
    const avatar = scope.querySelector(AVATAR_SELECTOR) || element.querySelector(AVATAR_SELECTOR);

    let raw = '';
    if (link) {
      raw = (link.textContent || '').trim();
      if (!raw || /\s/.test(raw)) raw = loginFromHref(link.getAttribute('href')) || raw;
    }
    if (!raw && avatar) {
      raw = (avatar.getAttribute('alt') || '').trim();
    }

    const avatarSrc = avatar ? avatar.getAttribute('src') || '' : '';
    const badgeScope = scope.querySelectorAll('.Label, span[class*="Label"], [data-testid="bot-badge"]');
    let botBadge = false;
    for (const node of badgeScope) {
      if ((node.textContent || '').trim().toLowerCase() === 'bot') {
        botBadge = true;
        break;
      }
    }

    return {
      login: normalizeLogin(raw),
      suffixedBot: /\[bot\]\s*$/i.test(raw),
      appAvatar: /githubusercontent\.com\/in\//i.test(avatarSrc),
      botBadge
    };
  }

  function commentNodes(row) {
    const found = row.querySelectorAll(COMMENT_SELECTOR);
    if (found.length) return Array.from(found);
    if (row.matches && row.matches(COMMENT_SELECTOR)) return [row];
    return [];
  }

  function hasCommentBody(row) {
    return Boolean(row.querySelector('.comment-body, .js-comment-body, [data-testid="markdown-body"], markdown-accessiblity-table'));
  }

  function isPinned(row) {
    if (row.querySelector(ALWAYS_PIN_SELECTOR) || (row.matches && row.matches(ALWAYS_PIN_SELECTOR))) return true;
    if (hasCommentBody(row)) return false;
    return Boolean(row.querySelector(COMPOSER_SELECTOR));
  }

  const TIMELINE_ROOT_SELECTOR = [
    '.js-discussion',
    '[data-testid="issue-viewer-comments-container"]',
    '[data-testid="issue-timeline"]',
    '[data-testid="timeline"]'
  ].join(',');

  const TIMELINE_ITEM_SELECTOR = [
    '.js-timeline-item',
    '.TimelineItem',
    '[data-testid="timeline-item"]',
    '[data-testid="issue-comment"]',
    '[data-testid="issue-timeline-item"]'
  ].join(',');

  const FILES_ROOT_SELECTOR = '#files, [data-testid="diff-view"], .js-diff-progressive-container';

  const THREAD_SELECTOR = [
    '.js-resolvable-timeline-thread-container',
    '.review-thread-component',
    '[data-testid="review-thread"]',
    'tr.inline-comments'
  ].join(',');

  function outermost(elements, root) {
    const set = new Set(elements);
    return elements.filter((element) => {
      let parent = element.parentElement;
      while (parent && parent !== root) {
        if (set.has(parent)) return false;
        parent = parent.parentElement;
      }
      return true;
    });
  }

  function findTimelineRoot(scope) {
    const doc = scope || document;
    const direct = doc.querySelector(TIMELINE_ROOT_SELECTOR);
    if (direct) return direct;

    const items = doc.querySelectorAll(TIMELINE_ITEM_SELECTOR);
    if (!items.length) return null;

    const tally = new Map();
    for (const item of items) {
      const parent = item.parentElement;
      if (!parent) continue;
      tally.set(parent, (tally.get(parent) || 0) + 1);
    }

    let best = null;
    let bestCount = 0;
    for (const [parent, count] of tally) {
      if (count > bestCount) {
        best = parent;
        bestCount = count;
      }
    }
    return best;
  }

  function findFilesRoot(scope) {
    return (scope || document).querySelector(FILES_ROOT_SELECTOR);
  }

  function timelineRows(root) {
    const items = outermost(Array.from(root.querySelectorAll(TIMELINE_ITEM_SELECTOR)), root);
    if (items.length) return items;
    return Array.from(root.children).filter((node) => node.nodeType === 1);
  }

  function threadRows(root) {
    return outermost(Array.from(root.querySelectorAll(THREAD_SELECTOR)), root);
  }

  function classifyRow(row, rules) {
    const comments = commentNodes(row);
    if (!comments.length) {
      const author = readAuthor(row);
      if (hasCommentBody(row)) return classifyAuthor(author, rules);
      return author.login && classifyAuthor(author, rules) === 'bot' ? 'bot' : 'activity';
    }

    let sawHuman = false;
    let sawBot = false;
    for (const comment of comments) {
      if (classifyAuthor(readAuthor(comment), rules) === 'human') sawHuman = true;
      else sawBot = true;
    }
    if (sawHuman) return 'human';
    if (sawBot) return 'bot';
    return 'activity';
  }

  root.PRLanes = {
    DEFAULT_BOT_LOGINS,
    buildRules,
    classifyAuthor,
    classifyRow,
    commentNodes,
    findFilesRoot,
    findTimelineRoot,
    isPinned,
    normalizeLogin,
    outermost,
    parseLoginList,
    readAuthor,
    threadRows,
    timelineRows
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
