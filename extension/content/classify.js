(function (root) {
  'use strict';

  const DEFAULTS = {
    defaultLane: 'human',
    rememberPerPr: false,
    hideActivityInHumanLane: false,
    hideResolvedThreads: false,
    extraBots: '',
    forceHumans: '',
    heuristics: true
  };

  const CLASSIFICATION_KEYS = ['extraBots', 'forceHumans', 'heuristics'];

  const DEFAULT_BOT_LOGINS = [
    'allcontributors',
    'argos-ci',
    'bundlemon',
    'changeset-bot',
    'codecov',
    'codecov-commenter',
    'codspeed-hq',
    'coderabbitai',
    'copilot',
    'copilot-pull-request-reviewer',
    'deepsource-autofix',
    'dependabot',
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
    'trunk-io',
    'vercel'
  ];

  const HEURISTIC_PATTERNS = [
    /(^|[-_.])((ci|cd|deploy|build)-?)?bots?$/i,
    /^bot[-_.]/i,
    /(^|[-_.])(app|action|actions|ci|cd)$/i
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

  const COMMENT_BODY_SELECTOR = '.comment-body, .js-comment-body, [data-testid="markdown-body"]';

  const AUTHOR_SELECTOR = [
    '.author',
    '[data-testid="avatar-link"]',
    '[data-testid="issue-body-header-author"]',
    '[data-testid="comment-header-author"]',
    '[data-testid="author-link"]'
  ].join(',');

  const AVATAR_SELECTOR = 'img[class*="avatar" i], img[data-component="Avatar"], img[src*="avatars."]';

  const BADGE_SELECTOR = '.Label, span[class*="Label"], [data-testid="bot-badge"]';

  const BADGE_TEXT = ['bot', 'ai'];

  const APP_HREF = /^\/apps\/([^/?#]+)/;

  const HEADER_SELECTOR = [
    '.timeline-comment-header',
    '.review-comment-header',
    '[data-testid="comment-header"]',
    '[data-testid="issue-body-header"]'
  ].join(',');

  const COMPOSER_SELECTOR = 'textarea, [data-testid="comment-composer"], [data-testid="markdown-editor"]';

  const PR_BODY_SELECTOR = '[data-testid="issue-body"], [id^="issue-"]';
  const PR_BODY_ID = /^issue-\d+$/;

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

  const RESOLVABLE_THREAD_SELECTOR = '.js-resolvable-timeline-thread-container[data-resolved], review-thread-collapsible[data-resolved], [data-testid="review-thread"][data-resolved]';

  const SIDEBAR_SECTION_SELECTOR = '.js-issue-sidebar-form, [data-testid*="reviewers"], [data-testid="sidebar-reviewers-section"]';

  const REVIEWER_LINK_SELECTOR = 'a[href^="/apps/"], a[data-hovercard-url], a.assignee, a[href^="/orgs/"]';

  const THREAD_SELECTOR = [
    '.js-resolvable-timeline-thread-container',
    '.review-thread-component',
    '[data-testid="review-thread"]',
    'tr.inline-comments'
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
    if (author && (author.suffixedBot || author.appLink)) return 'bot';
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

  function authoredAvatar(element, header) {
    const candidates = header ? [header, element] : [element];
    for (const scope of candidates) {
      for (const image of scope.querySelectorAll(AVATAR_SELECTOR)) {
        if (!image.closest(COMMENT_BODY_SELECTOR)) return image;
      }
    }
    return null;
  }

  function readAuthor(element) {
    const header = element.querySelector(HEADER_SELECTOR);
    const link = (header && header.querySelector(AUTHOR_SELECTOR)) || element.querySelector(AUTHOR_SELECTOR);
    const href = link ? link.getAttribute('href') || '' : '';
    const app = href.match(APP_HREF);

    let raw = link ? (link.textContent || '').trim() : '';
    if (link && (!raw || /\s/.test(raw))) raw = (app ? app[1] : loginFromHref(href)) || raw;

    let avatar;
    const avatarImage = () => {
      if (avatar === undefined) avatar = authoredAvatar(element, header);
      return avatar;
    };

    if (!raw) {
      const image = avatarImage();
      raw = image ? (image.getAttribute('alt') || '').trim() : '';
    }

    return {
      login: normalizeLogin(raw),
      suffixedBot: /\[bot\]\s*$/i.test(raw),
      appLink: Boolean(app),
      get appAvatar() {
        const image = avatarImage();
        return Boolean(image) && /githubusercontent\.com\/in\//i.test(image.getAttribute('src') || '');
      },
      get botBadge() {
        const scope = header || (link && link.parentElement) || element;
        for (const node of scope.querySelectorAll(BADGE_SELECTOR)) {
          if (BADGE_TEXT.includes((node.textContent || '').trim().toLowerCase())) return true;
        }
        return false;
      }
    };
  }

  function commentNodes(row) {
    const found = row.querySelectorAll(COMMENT_SELECTOR);
    if (found.length) return Array.from(found);
    if (row.matches && row.matches(COMMENT_SELECTOR)) return [row];
    return [];
  }

  function hasCommentBody(row) {
    return Boolean(row.querySelector(COMMENT_BODY_SELECTOR));
  }

  function isPrBody(row) {
    const node = (row.matches && row.matches(PR_BODY_SELECTOR) && row) || row.querySelector(PR_BODY_SELECTOR);
    if (!node) return false;
    return node.id ? PR_BODY_ID.test(node.id) : true;
  }

  function classifyRow(row, rules) {
    if (hasCommentBody(row)) {
      const authors = commentNodes(row).map(readAuthor).filter((author) => author.login);
      if (!authors.length) authors.push(readAuthor(row));
      const actor = authors.some((author) => classifyAuthor(author, rules) === 'human') ? 'human' : 'bot';
      return { actor, form: 'comment' };
    }

    if (row.querySelector(COMPOSER_SELECTOR)) return { actor: 'none', form: 'chrome' };

    const author = readAuthor(row);
    if (!author.login) return { actor: 'none', form: 'chrome' };

    return { actor: classifyAuthor(author, rules), form: 'event' };
  }

  function resolvableThreads(root) {
    return Array.from(root.querySelectorAll(RESOLVABLE_THREAD_SELECTOR));
  }

  function isResolved(thread) {
    return thread.getAttribute('data-resolved') === 'true';
  }

  function findReviewersRoot(scope) {
    for (const section of (scope || document).querySelectorAll(SIDEBAR_SECTION_SELECTOR)) {
      const heading = section.querySelector('h3, summary, [class*="Heading"], [class*="heading"]');
      if (heading && /^\s*reviewers/i.test(heading.textContent || '')) return section;
    }
    return null;
  }

  function reviewerIdentities(element) {
    const links = Array.from(element.querySelectorAll(REVIEWER_LINK_SELECTOR));
    if (element.matches && element.matches(REVIEWER_LINK_SELECTOR)) links.push(element);
    return new Set(links.map((link) => (link.getAttribute('href') || '').split('?')[0]));
  }

  function reviewerRows(root) {
    const rows = new Set();

    for (const link of root.querySelectorAll(REVIEWER_LINK_SELECTOR)) {
      let row = link;
      let owned = reviewerIdentities(row).size;

      while (row.parentElement && row.parentElement !== root) {
        const parentOwned = reviewerIdentities(row.parentElement).size;
        if (parentOwned !== owned) break;
        row = row.parentElement;
        owned = parentOwned;
      }

      rows.add(row);
    }

    return outermost(Array.from(rows), root);
  }

  function classifyReviewer(row, rules) {
    const link = row.querySelector(REVIEWER_LINK_SELECTOR);
    const href = link ? link.getAttribute('href') || '' : '';
    const app = href.match(APP_HREF);

    let raw = link ? (link.textContent || '').trim() : '';
    if (!raw || /\s/.test(raw)) raw = (app ? app[1] : loginFromHref(href)) || raw;

    const image = row.querySelector(AVATAR_SELECTOR);

    const author = {
      login: normalizeLogin(raw),
      suffixedBot: /\[bot\]\s*$/i.test(raw),
      appLink: Boolean(app),
      appAvatar: Boolean(image) && /githubusercontent\.com\/in\//i.test(image.getAttribute('src') || '')
    };

    return { actor: classifyAuthor(author, rules), form: 'reviewer' };
  }

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

  root.PRLanes = Object.assign(root.PRLanes || {}, {
    CLASSIFICATION_KEYS,
    DEFAULTS,
    DEFAULT_BOT_LOGINS,
    buildRules,
    classifyAuthor,
    classifyReviewer,
    classifyRow,
    findFilesRoot,
    findReviewersRoot,
    isResolved,
    findTimelineRoot,
    isPrBody,
    normalizeLogin,
    parseLoginList,
    resolvableThreads,
    reviewerRows,
    threadRows,
    timelineRows
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
