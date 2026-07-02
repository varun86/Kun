import type { DesignArtifact, DesignPrototypeLink } from './design-types'
import {
  defaultFrameSizeForDesignTarget,
  defaultPreviewNodeSizeForDesignTarget
} from './design-context'

export type PrototypePlayerLink = DesignPrototypeLink & {
  targetArtifactId: string
  targetTitle: string
  targetRelativePath?: string
}

export type PrototypePlayerScreen = {
  id: string
  title: string
  relativePath: string
}

export type PrototypePlayerViewportFrame = {
  width: number
  height: number
  orientation: 'landscape' | 'portrait'
}

export type PrototypePlayerNavigationState = {
  currentId: string | null
  history: readonly string[]
  missingHref: string
}

export type PrototypeMissingScreenPromptValues = {
  current: string
  href: string
  sourcePath: string
  suggestedTitle: string
}

const PROTOTYPE_NAV_HASH_PREFIX = 'kun-proto-nav='
const PROTOTYPE_BACK_HASH_PREFIX = 'kun-proto-back='
const PROTOTYPE_NAV_SELECTOR =
  'a[href],[data-prototype-href],[data-href],[data-prototype-target],[data-target],[onclick],button[data-href],button[data-prototype-href],button[data-prototype-target],button[data-target]'

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ')
}

function titleTokens(title: string): string[] {
  return normalizeTitle(title).split(' ').filter(Boolean)
}

function fuzzyTitleMatch(query: string, candidate: string): boolean {
  const queryTokens = titleTokens(query)
  const candidateTokens = titleTokens(candidate)
  if (queryTokens.length === 0 || candidateTokens.length === 0) return false
  return (
    queryTokens.every((token) => candidateTokens.includes(token)) ||
    candidateTokens.every((token) => queryTokens.includes(token))
  )
}

function uniqueFuzzyLinkTitleMatch(
  query: string,
  links: readonly PrototypePlayerLink[]
): PrototypePlayerLink | null {
  const matches = links.filter((link) => fuzzyTitleMatch(query, link.targetTitle))
  return matches.length === 1 ? matches[0] : null
}

function uniqueExactLinkTitleMatch(
  query: string,
  links: readonly PrototypePlayerLink[]
): PrototypePlayerLink | null {
  const normalized = normalizeTitle(query)
  if (!normalized) return null
  const matches = links.filter((link) => normalizeTitle(link.targetTitle) === normalized)
  return matches.length === 1 ? matches[0] : null
}

function normalizeUrlForCompare(value: string, baseUrl: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    const url = new URL(trimmed, baseUrl)
    url.hash = ''
    url.search = ''
    return url.href
  } catch {
    return trimmed
  }
}

function normalizePathForCompare(value: string): string {
  return cleanPrototypePath(value).toLowerCase()
}

function cleanPrototypePath(value: string): string {
  return value.trim().replaceAll('\\', '/').replace(/[?#].*$/, '').replace(/^\/+/, '')
}

function isPageLikePrototypePath(value: string): boolean {
  const path = value.trim().replaceAll('\\', '/').replace(/[?#].*$/, '').replace(/^\/+/, '')
  if (!path || path === '.' || path === '..') return false
  return /\.(?:html|htm)$/i.test(path) || !/\.[a-z0-9]{2,8}$/i.test(path)
}

export function extractPrototypeHashRouteHref(navigationUrl: string): string | null {
  let hash = extractPrototypeHashValue(navigationUrl)
  if (!hash || hash.startsWith(PROTOTYPE_NAV_HASH_PREFIX)) return null
  if (hash.startsWith('!')) hash = hash.slice(1)
  const routeLike =
    /^(?:\/|\.\/|\.\.\/)/.test(hash) ||
    /\.(?:html|htm)(?:[?#].*)?$/i.test(hash)
  return routeLike && isPageLikePrototypePath(hash) ? hash : null
}

function extractPrototypeHashValue(navigationUrl: string): string | null {
  const raw = navigationUrl.trim()
  if (!raw) return null
  let hash = ''
  if (raw.startsWith('#')) {
    hash = raw.slice(1)
  } else {
    try {
      hash = new URL(raw).hash.slice(1)
    } catch {
      return null
    }
  }
  if (!hash) return null
  try {
    return decodeURIComponent(hash)
  } catch {
    return hash
  }
}

function extractPrototypePlainHashTarget(navigationUrl: string): string | null {
  let hash = extractPrototypeHashValue(navigationUrl)
  if (!hash || hash.startsWith(PROTOTYPE_NAV_HASH_PREFIX) || hash.startsWith(PROTOTYPE_BACK_HASH_PREFIX)) {
    return null
  }
  if (extractPrototypeHashRouteHref(navigationUrl)) return null
  if (hash.startsWith('!')) hash = hash.slice(1)
  const cleaned = hash.replace(/[?#].*$/, '').replace(/^\/+/, '').trim()
  return cleaned ? humanizeRouteSegment(cleaned) : null
}

function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

function humanizeRouteSegment(segment: string): string {
  const cleaned = decodePathSegment(segment)
    .replace(/\.(?:html?|xhtml)$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return ''
  return cleaned
    .split(' ')
    .map((word) => (/^[A-Z0-9]{2,}$/.test(word) ? word : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()))
    .join(' ')
}

function normalizeRouteSlug(value: string): string {
  return normalizeTitle(value.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' '))
}

function routeSlugCandidates(value: string, baseUrl: string): string[] {
  const raw = value.trim()
  if (!raw) return []
  let path = raw
  try {
    path = new URL(raw, baseUrl).pathname
  } catch {
    // Keep the raw relative value when it is not parseable as a URL.
  }
  const segments = cleanPrototypePath(path).split('/').filter(Boolean).map(decodePathSegment)
  if (segments.length === 0) return []
  const last = segments[segments.length - 1]
  const lastSlug = normalizeRouteSlug(last)
  const sourceSegments =
    /^(?:index|v\d+)$/i.test(lastSlug) && segments.length > 1
      ? [segments[segments.length - 2]]
      : [last]
  const slugs = sourceSegments
    .map(normalizeRouteSlug)
    .filter((slug) => slug && !/^(?:index|v\d+)$/.test(slug))
  return Array.from(new Set(slugs))
}

function uniqueRouteSlugLinkMatch(
  href: string,
  currentFileUrl: string,
  links: readonly PrototypePlayerLink[]
): PrototypePlayerLink | null {
  const slugs = routeSlugCandidates(href, currentFileUrl)
  if (slugs.length === 0) return null
  const matches = links.filter((link) => {
    const linkIdSlug = normalizeRouteSlug(link.targetArtifactId)
    const linkPathSlugs = link.targetRelativePath ? routeSlugCandidates(link.targetRelativePath, currentFileUrl) : []
    return slugs.some((slug) => (
      slug === linkIdSlug ||
      linkPathSlugs.includes(slug) ||
      fuzzyTitleMatch(slug, link.targetTitle)
    ))
  })
  return matches.length === 1 ? matches[0] : null
}

function uniqueRelativePathLinkMatch(
  href: string,
  links: readonly PrototypePlayerLink[]
): PrototypePlayerLink | null {
  const normalizedPath = normalizePathForCompare(href)
  if (!normalizedPath) return null
  const pathHasDirectory = normalizedPath.includes('/')
  const matches = links.filter((link) => {
    if (!link.targetRelativePath) return false
    const targetPath = normalizePathForCompare(link.targetRelativePath)
    return (
      normalizedPath === targetPath ||
      normalizedPath.endsWith(`/${targetPath}`) ||
      (pathHasDirectory && targetPath.endsWith(`/${normalizedPath}`))
    )
  })
  return matches.length === 1 ? matches[0] : null
}

function buildRelativePrototypeHref(fromHtmlPath: string, toHtmlPath: string): string {
  const fromParts = cleanPrototypePath(fromHtmlPath).split('/').filter(Boolean)
  const targetParts = cleanPrototypePath(toHtmlPath).split('/').filter(Boolean)
  fromParts.pop()
  let shared = 0
  while (
    shared < fromParts.length &&
    shared < targetParts.length &&
    fromParts[shared] === targetParts[shared]
  ) {
    shared += 1
  }
  const up = fromParts.slice(shared).map(() => '..')
  const down = targetParts.slice(shared)
  return [...up, ...down].join('/') || './'
}

function positiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function sameSize(
  actual: { width: number; height: number },
  expected: { width: number; height: number }
): boolean {
  return Math.abs(actual.width - expected.width) <= 0.5 && Math.abs(actual.height - expected.height) <= 0.5
}

function viewportFrameFromSize(size: { width: number; height: number }): PrototypePlayerViewportFrame {
  const width = Math.max(1, Math.round(size.width))
  const height = Math.max(1, Math.round(size.height))
  return {
    width,
    height,
    orientation: height > width ? 'portrait' : 'landscape'
  }
}

function isTargetManagedAutoNodeSize(size: { width: number; height: number }): boolean {
  return (
    sameSize(size, defaultPreviewNodeSizeForDesignTarget('web')) ||
    sameSize(size, defaultPreviewNodeSizeForDesignTarget('app')) ||
    sameSize(size, defaultFrameSizeForDesignTarget('web')) ||
    sameSize(size, defaultFrameSizeForDesignTarget('app'))
  )
}

export function resolvePrototypeViewportFrame(
  artifact: DesignArtifact | null | undefined,
  fallbackTarget?: unknown
): PrototypePlayerViewportFrame {
  const fallback = defaultFrameSizeForDesignTarget(fallbackTarget)
  const node = artifact?.kind === 'html' ? artifact.node : undefined
  if (!node || !positiveFinite(node.width) || !positiveFinite(node.height)) {
    return viewportFrameFromSize(fallback)
  }
  const nodeSize = { width: node.width, height: node.height }
  if (node.sizeMode !== 'manual' && isTargetManagedAutoNodeSize(nodeSize)) {
    return viewportFrameFromSize(fallback)
  }
  return viewportFrameFromSize(nodeSize)
}

export function shouldCapturePrototypeNavigationHref(value: string, baseUrl: string): boolean {
  const raw = value.trim()
  if (!raw || raw.startsWith('?')) return false
  if (raw.startsWith('#')) return extractPrototypeHashRouteHref(raw) !== null
  if (/^(?:javascript|mailto|tel|data):/i.test(raw)) return false
  if (!/^[a-z][a-z\d+.-]*:/i.test(raw)) return isPageLikePrototypePath(raw)
  try {
    const url = new URL(raw, baseUrl)
    const base = new URL(baseUrl)
    if (url.protocol === 'file:') return isPageLikePrototypePath(url.pathname)
    return url.origin === base.origin && isPageLikePrototypePath(url.pathname)
  } catch {
    return false
  }
}

export function extractPrototypeNavigationHref(navigationUrl: string): string | null {
  const raw = navigationUrl.trim()
  if (!raw) return null
  const hash = raw.startsWith('#')
    ? raw.slice(1)
    : (() => {
        try {
          return new URL(raw).hash.slice(1)
        } catch {
          return ''
        }
      })()
  if (!hash.startsWith(PROTOTYPE_NAV_HASH_PREFIX)) return null
  return decodeURIComponent(hash.slice(PROTOTYPE_NAV_HASH_PREFIX.length))
}

export function isPrototypeBackNavigation(navigationUrl: string): boolean {
  return prototypeBackNavigationSteps(navigationUrl) !== null
}

export function prototypeBackNavigationSteps(navigationUrl: string): number | null {
  const raw = navigationUrl.trim()
  if (!raw) return null
  let hash = ''
  if (raw.startsWith('#')) {
    hash = raw.slice(1)
  } else {
    try {
      hash = new URL(raw).hash.slice(1)
    } catch {
      return null
    }
  }
  try {
    hash = decodeURIComponent(hash)
  } catch {
    // Keep the raw hash when it is not URI-encoded cleanly.
  }
  if (!hash.startsWith(PROTOTYPE_BACK_HASH_PREFIX)) return null
  const payload = hash.slice(PROTOTYPE_BACK_HASH_PREFIX.length)
  try {
    const params = new URLSearchParams(payload)
    const steps = Number(params.get('steps'))
    if (Number.isFinite(steps) && steps > 0) return Math.max(1, Math.floor(steps))
  } catch {
    // Legacy back signals had an opaque timestamp after the prefix.
  }
  return 1
}

export function resolvePrototypeNavigationTarget(
  navigationUrl: string,
  currentFileUrl: string,
  links: readonly PrototypePlayerLink[]
): PrototypePlayerLink | null {
  const capturedHref = extractPrototypeNavigationHref(navigationUrl)
  const hashRouteHref = capturedHref
    ? extractPrototypeHashRouteHref(capturedHref)
    : extractPrototypeHashRouteHref(navigationUrl)
  const hashTarget = capturedHref
    ? extractPrototypePlainHashTarget(capturedHref)
    : extractPrototypePlainHashTarget(navigationUrl)
  const href = hashRouteHref ?? hashTarget ?? capturedHref ?? navigationUrl
  const normalizedHref = normalizeUrlForCompare(href, currentFileUrl)
  const normalizedTargetTitle = normalizeTitle(href)
  if (!normalizedTargetTitle) return null
  for (const link of links) {
    if (link.href) {
      if (href === link.href) return link
      const normalizedLink = normalizeUrlForCompare(link.href, currentFileUrl)
      if (normalizedHref && normalizedLink && normalizedHref === normalizedLink) return link
    }
  }
  return (
    uniqueRelativePathLinkMatch(href, links) ??
    uniqueExactLinkTitleMatch(href, links) ??
    uniqueRouteSlugLinkMatch(href, currentFileUrl, links) ??
    uniqueFuzzyLinkTitleMatch(href, links)
  )
}

export function buildPrototypeNavigationCaptureScript(links: readonly PrototypePlayerLink[]): string {
  const hrefs = links.map((link) => link.href).filter((href): href is string => Boolean(href?.trim()))
  const targetTitles = links.map((link) => link.targetTitle).filter((title) => title.trim())
  return `
(() => {
  const key = '__kunPrototypeNavCaptureInstalled';
  const titleKey = '__kunPrototypeNavCaptureTitles';
  const hrefs = ${JSON.stringify(hrefs)};
  const targetTitles = ${JSON.stringify(targetTitles)};
  const normalize = (value) => {
    try {
      const url = new URL(value, document.baseURI);
      url.hash = '';
      url.search = '';
      return url.href;
    } catch {
      return String(value || '').trim();
    }
  };
  const normalizeTitle = (value) => String(value || '').trim().toLowerCase().replace(/\\s+/g, ' ');
  const titleTokens = (value) => normalizeTitle(value).split(' ').filter(Boolean);
  const fuzzyTitleMatch = (query, candidate) => {
    const queryTokens = titleTokens(query);
    const candidateTokens = titleTokens(candidate);
    if (queryTokens.length === 0 || candidateTokens.length === 0) return false;
    return queryTokens.every((token) => candidateTokens.includes(token)) ||
      candidateTokens.every((token) => queryTokens.includes(token));
  };
  const hasUniqueFuzzyTargetTitle = (value, titles) => {
    let count = 0;
    for (const title of titles) {
      if (fuzzyTitleMatch(value, title)) count += 1;
      if (count > 1) return false;
    }
    return count === 1;
  };
  const isPageLikePrototypePath = (pathValue) => {
    const path = String(pathValue || '').trim().replace(/\\\\/g, '/').replace(/[?#].*$/, '').replace(/^\\/+/, '');
    if (!path || path === '.' || path === '..') return false;
    return /\\.(?:html|htm)$/i.test(path) || !/\\.[a-z0-9]{2,8}$/i.test(path);
  };
	  const hashRouteHref = (routeValue) => {
	    let hash = '';
	    const routeRaw = String(routeValue || '').trim();
	    if (routeRaw.startsWith('#')) {
	      hash = routeRaw.slice(1);
	    } else {
      try {
        hash = new URL(routeRaw, document.baseURI).hash.slice(1);
      } catch {
        return '';
      }
    }
    if (!hash) return '';
    try {
      hash = decodeURIComponent(hash);
    } catch {}
    if (!hash || hash.startsWith('${PROTOTYPE_NAV_HASH_PREFIX}')) return '';
    if (hash.startsWith('!')) hash = hash.slice(1);
	    const routeLike = /^(?:\\/|\\.\\/|\\.\\.\\/)/.test(hash) || /\\.(?:html|htm)(?:[?#].*)?$/i.test(hash);
	    return routeLike && isPageLikePrototypePath(hash) ? hash : '';
	  };
	  const plainHashTargetTitle = (routeValue) => {
	    const routeRaw = String(routeValue || '').trim();
	    if (!routeRaw.startsWith('#') || hashRouteHref(routeRaw)) return '';
	    let hash = routeRaw.slice(1);
	    try {
	      hash = decodeURIComponent(hash);
	    } catch {}
	    if (!hash || hash.startsWith('${PROTOTYPE_NAV_HASH_PREFIX}') || hash.startsWith('${PROTOTYPE_BACK_HASH_PREFIX}')) return '';
	    if (hash.startsWith('!')) hash = hash.slice(1);
	    return hash.replace(/[?#].*$/, '').replace(/^\\/+/, '').replace(/[-_]+/g, ' ').replace(/\\s+/g, ' ').trim();
	  };
	  const hasSamePageAnchor = (routeValue) => {
	    const routeRaw = String(routeValue || '').trim();
	    if (!routeRaw.startsWith('#') || hashRouteHref(routeRaw)) return false;
	    let hash = routeRaw.slice(1);
	    try {
	      hash = decodeURIComponent(hash);
	    } catch {}
	    hash = hash.replace(/[?#].*$/, '').trim();
	    if (!hash) return false;
	    return Boolean(
	      (typeof document.getElementById === 'function' && document.getElementById(hash)) ||
	      (typeof document.getElementsByName === 'function' && document.getElementsByName(hash).length > 0)
	    );
	  };
	  const allowed = new Set();
  for (const href of hrefs) {
    allowed.add(href);
    allowed.add(normalize(href));
  }
  const allowedTitles = new Set();
  for (const title of targetTitles) allowedTitles.add(normalizeTitle(title));
	  const shouldCapture = (value) => {
	    const raw = String(value || '').trim();
	    if (!raw || raw.startsWith('?')) return false;
	    if (/^(?:javascript|mailto|tel|data):/i.test(raw)) return false;
	    if (raw.startsWith('#')) {
	      const routeHref = hashRouteHref(raw);
	      if (routeHref) return true;
	      const targetTitle = plainHashTargetTitle(raw);
	      return Boolean(targetTitle && !hasSamePageAnchor(raw) && isKnownTargetTitle(targetTitle));
	    }
	    if (!/^[a-z][a-z\\d+.-]*:/i.test(raw)) return isPageLikePrototypePath(raw);
    try {
      const url = new URL(raw, document.baseURI);
      const base = new URL(document.baseURI);
      if (url.protocol === 'file:') return isPageLikePrototypePath(url.pathname);
      return url.origin === base.origin && isPageLikePrototypePath(url.pathname);
    } catch {
      return false;
    }
  };
  window[key] = allowed;
  window[titleKey] = allowedTitles;
  const currentAllowed = () => window[key] instanceof Set ? window[key] : allowed;
  const currentTitleAllowed = () => window[titleKey] instanceof Set ? window[titleKey] : allowedTitles;
  const isKnownTargetTitle = (value) => {
    const titles = currentTitleAllowed();
    return titles.has(normalizeTitle(value)) || hasUniqueFuzzyTargetTitle(value, titles);
  };
  const hrefFromInlineHandler = (handler) => {
    const text = String(handler || '').trim();
    if (!text) return '';
    const historyMatch = text.match(/(?:window\\.)?history\\.(?:pushState|replaceState)\\s*\\(\\s*[\\s\\S]*?,\\s*(['"])[^'"]*\\1\\s*,\\s*(['"])([^'"]+)\\2\\s*\\)/i);
    if (historyMatch) return historyMatch[3] || '';
    const assignMatch = text.match(/(?:window\\.)?location\\.(?:assign|replace)\\s*\\(\\s*(['"])([^'"]+)\\1\\s*\\)/i);
    if (assignMatch) return assignMatch[2] || '';
    const hrefMatch = text.match(/(?:window\\.)?location(?:\\.href)?\\s*=\\s*(['"])([^'"]+)\\1/i);
    if (hrefMatch) return hrefMatch[2] || '';
    const hashMatch = text.match(/(?:window\\.)?location\\.hash\\s*=\\s*(['"])([^'"]+)\\1/i);
    return hashMatch ? hashMatch[2] || '' : '';
  };
  const hrefFromElement = (el) =>
    el.getAttribute('data-prototype-href') ||
    el.getAttribute('data-href') ||
    el.getAttribute('data-prototype-target') ||
    el.getAttribute('data-target') ||
    el.getAttribute('href') ||
    hrefFromInlineHandler(el.getAttribute('onclick'));
  const shouldNavigateElement = (el, href) => {
    const targetOnly = !el.hasAttribute('href') && !el.hasAttribute('data-prototype-href') && !el.hasAttribute('data-href');
    if (!targetOnly) return true;
	    const raw = String(href || '').trim();
	    const looksLikePrototypePath = raw.includes('/') && shouldCapture(raw);
	    const liveAllowed = currentAllowed();
	    const targetTitle = raw.startsWith('#') ? plainHashTargetTitle(raw) : raw;
	    return liveAllowed.has(raw) || liveAllowed.has(normalize(raw)) || looksLikePrototypePath || isKnownTargetTitle(targetTitle);
	  };
	  const navigate = (href, event) => {
	    const raw = String(href).trim();
	    if (!raw) return false;
	    const navHref = raw.startsWith('#') ? (hashRouteHref(raw) || plainHashTargetTitle(raw)) : raw;
	    if (!navHref) return false;
    const liveAllowed = currentAllowed();
    if (
      !liveAllowed.has(raw) &&
      !liveAllowed.has(navHref) &&
      !liveAllowed.has(normalize(raw)) &&
      !liveAllowed.has(normalize(navHref)) &&
      !shouldCapture(raw)
    ) return false;
    event.preventDefault();
    event.stopPropagation();
    window.location.hash = '${PROTOTYPE_NAV_HASH_PREFIX}' + encodeURIComponent(navHref);
    return true;
  };
  const signalBack = (steps) => {
    const count = Math.max(1, Math.floor(Number(steps) || 1));
    window.location.hash = '${PROTOTYPE_BACK_HASH_PREFIX}' + encodeURIComponent('steps=' + count + '&t=' + Date.now());
    return undefined;
  };
  const backStepsFromInlineHandler = (handler) => {
    const text = String(handler || '').trim();
    if (!text) return 0;
    if (/(?:window\\.)?history\\.back\\s*\\(\\s*\\)/i.test(text)) return 1;
    const goMatch = text.match(/(?:window\\.)?history\\.go\\s*\\(\\s*(-\\d+)\\s*\\)/i);
    if (!goMatch) return 0;
    const steps = Math.abs(Number(goMatch[1]));
    return Number.isFinite(steps) && steps > 0 ? Math.floor(steps) : 0;
  };
  const signalBackFromElement = (el, event) => {
    const steps = backStepsFromInlineHandler(el.getAttribute('onclick'));
    if (!steps) return false;
    event.preventDefault();
    event.stopPropagation();
    signalBack(steps);
    return true;
  };
  if (!window.__kunPrototypeNavListenerInstalled) {
    window.__kunPrototypeNavListenerInstalled = true;
    window.__kunPrototypeOriginalOpen = window.__kunPrototypeOriginalOpen || window.open;
    if (!window.__kunPrototypeWindowOpenPatched && typeof window.__kunPrototypeOriginalOpen === 'function') {
      window.__kunPrototypeWindowOpenPatched = true;
      window.open = function(url, target, features) {
        const raw = String(url || '').trim();
        if (raw && navigate(raw, { preventDefault() {}, stopPropagation() {} })) return null;
        return window.__kunPrototypeOriginalOpen.call(window, url, target, features);
      };
    }
    const patchHistoryMethod = (methodName, originalKey, patchedKey) => {
      if (!window.history || window[patchedKey] || typeof window.history[methodName] !== 'function') return;
      window[patchedKey] = true;
      window[originalKey] = window[originalKey] || window.history[methodName];
      window.history[methodName] = function(state, title, url) {
        const raw = String(url || '').trim();
        if (raw && navigate(raw, { preventDefault() {}, stopPropagation() {} })) return undefined;
        return window[originalKey].apply(window.history, arguments);
      };
    };
    patchHistoryMethod('pushState', '__kunPrototypeOriginalPushState', '__kunPrototypePushStatePatched');
    patchHistoryMethod('replaceState', '__kunPrototypeOriginalReplaceState', '__kunPrototypeReplaceStatePatched');
    if (window.history && !window.__kunPrototypeBackPatched) {
      window.__kunPrototypeBackPatched = true;
      window.__kunPrototypeOriginalBack = window.__kunPrototypeOriginalBack || window.history.back;
      window.__kunPrototypeOriginalGo = window.__kunPrototypeOriginalGo || window.history.go;
      if (typeof window.history.back === 'function') {
        window.history.back = function() {
          return signalBack(1);
        };
      }
      if (typeof window.history.go === 'function') {
        window.history.go = function(delta) {
          const steps = Number(delta);
          if (Number.isFinite(steps) && steps < 0) return signalBack(Math.abs(steps));
          return window.__kunPrototypeOriginalGo.apply(window.history, arguments);
        };
      }
    }
    document.addEventListener('click', (event) => {
      const target = event.target;
      const start = target && target.nodeType === Node.ELEMENT_NODE ? target : target?.parentElement;
      const el = start && start.closest
        ? start.closest('${PROTOTYPE_NAV_SELECTOR}')
        : null;
      if (!el) return;
      if (signalBackFromElement(el, event)) return;
      const href = hrefFromElement(el);
      if (!shouldNavigateElement(el, href)) return;
      navigate(href, event);
    }, true);
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const target = event.target;
      const start = target && target.nodeType === Node.ELEMENT_NODE ? target : target?.parentElement;
      const el = start && start.closest
        ? start.closest('${PROTOTYPE_NAV_SELECTOR}')
        : null;
      if (!el) return;
      if (/^(?:a|button|input|select|textarea)$/i.test(el.tagName)) return;
      if (signalBackFromElement(el, event)) return;
      const href = hrefFromElement(el);
      if (!shouldNavigateElement(el, href)) return;
      navigate(href, event);
    }, true);
    document.addEventListener('submit', (event) => {
      const form = event.target && event.target.matches && event.target.matches('form')
        ? event.target
        : null;
      if (!form) return;
      const submitter = event.submitter && event.submitter.getAttribute ? event.submitter : null;
      const href =
        (submitter && (
          submitter.getAttribute('data-prototype-href') ||
          submitter.getAttribute('data-href') ||
          submitter.getAttribute('data-prototype-target') ||
          submitter.getAttribute('data-target') ||
          submitter.getAttribute('formaction') ||
          submitter.formAction
        )) ||
        form.getAttribute('data-prototype-href') ||
        form.getAttribute('data-href') ||
        form.getAttribute('action') ||
        form.getAttribute('data-prototype-target') ||
        form.getAttribute('data-target') ||
        hrefFromInlineHandler(form.getAttribute('onsubmit'));
      navigate(href, event);
    }, true);
  }
  return true;
})()
`
}

export function resolveInitialPrototypeArtifactId(
  artifacts: readonly DesignArtifact[],
  preferredArtifactId?: string | null
): string | null {
  const htmlArtifacts = artifacts.filter((artifact) => artifact.kind === 'html')
  if (htmlArtifacts.length === 0) return null
  if (preferredArtifactId && htmlArtifacts.some((artifact) => artifact.id === preferredArtifactId)) {
    return preferredArtifactId
  }
  return htmlArtifacts.find((artifact) => (artifact.prototypeLinks?.length ?? 0) > 0)?.id ?? htmlArtifacts[0].id
}

export function resolvePreferredPrototypeArtifactId(
  artifacts: readonly DesignArtifact[],
  selectedArtifactId?: string | null,
  activeArtifactId?: string | null
): string | null {
  const htmlIds = new Set(artifacts.filter((artifact) => artifact.kind === 'html').map((artifact) => artifact.id))
  if (selectedArtifactId && htmlIds.has(selectedArtifactId)) return selectedArtifactId
  if (activeArtifactId && htmlIds.has(activeArtifactId)) return activeArtifactId
  return null
}

export function prototypePlayerNavigateTo(
  state: PrototypePlayerNavigationState,
  artifactId: string
): PrototypePlayerNavigationState {
  const targetId = artifactId.trim()
  if (!targetId || targetId === state.currentId) return state
  return {
    currentId: targetId,
    history: state.currentId ? [...state.history, state.currentId] : [...state.history],
    missingHref: ''
  }
}

export function prototypePlayerGoBack(
  state: PrototypePlayerNavigationState,
  steps = 1
): PrototypePlayerNavigationState {
  const parsedSteps = Number.isFinite(steps) ? steps : 1
  const count = Math.max(1, Math.floor(parsedSteps))
  const clampedCount = Math.min(count, state.history.length)
  const previous = clampedCount > 0 ? state.history[state.history.length - clampedCount] : null
  return {
    currentId: previous ?? state.currentId,
    history: clampedCount > 0 ? state.history.slice(0, -clampedCount) : [...state.history],
    missingHref: ''
  }
}

export function prototypeMissingScreenPromptValues(
  artifact: DesignArtifact | null | undefined,
  missingHref: string
): PrototypeMissingScreenPromptValues | null {
  const href = missingHref.trim()
  if (!href || !artifact || artifact.kind !== 'html') return null
  return {
    current: artifact.title || 'Current screen',
    href,
    sourcePath: artifact.relativePath,
    suggestedTitle: suggestedPrototypeScreenTitleFromHref(href)
  }
}

export function suggestedPrototypeScreenTitleFromHref(href: string): string {
  const raw = href.trim()
  if (!raw) return 'New screen'
  const hashRoute = extractPrototypeHashRouteHref(raw)
  let pathValue = hashRoute ?? raw
  if (!hashRoute && raw.startsWith('#')) pathValue = raw.slice(1)
  try {
    pathValue = new URL(pathValue, 'file:///prototype/current.html').pathname
  } catch {
    // Keep the raw target title or relative path.
  }
  const segments = cleanPrototypePath(pathValue).split('/').filter(Boolean)
  if (segments.length === 0) return humanizeRouteSegment(pathValue) || 'New screen'
  let source = segments[segments.length - 1]
  const sourceBase = decodePathSegment(source).replace(/\.(?:html?|xhtml)$/i, '')
  if (/^(?:index|v\d+)$/i.test(sourceBase) && segments.length > 1) {
    source = segments[segments.length - 2]
  }
  return humanizeRouteSegment(source) || 'New screen'
}

export function shouldInitializePrototypePlayerCurrentId(input: {
  open: boolean
  wasOpen: boolean
  currentId: string | null
}): boolean {
  return input.open && (!input.wasOpen || !input.currentId)
}

export function hasPrototypePlayback(artifacts: readonly DesignArtifact[]): boolean {
  return artifacts.some((artifact) => artifact.kind === 'html')
}

export function resolvePrototypeScreens(artifacts: readonly DesignArtifact[]): PrototypePlayerScreen[] {
  return artifacts
    .filter((artifact) => artifact.kind === 'html')
    .map((artifact) => ({
      id: artifact.id,
      title: artifact.title,
      relativePath: artifact.relativePath
    }))
}

export function resolvePrototypeLinks(
  artifact: DesignArtifact | null | undefined,
  artifacts: readonly DesignArtifact[]
): PrototypePlayerLink[] {
  if (!artifact || artifact.kind !== 'html') return []
  const htmlArtifacts = artifacts.filter((item): item is DesignArtifact & { kind: 'html' } => item.kind === 'html')
  const artifactsById = new Map(artifacts.map((item) => [item.id, item]))
  const uniqueExactArtifactByTitle = (title: string): (DesignArtifact & { kind: 'html' }) | undefined => {
    const normalized = normalizeTitle(title)
    if (!normalized) return undefined
    const matches = htmlArtifacts.filter((item) => normalizeTitle(item.title) === normalized)
    return matches.length === 1 ? matches[0] : undefined
  }
  const uniqueFuzzyArtifactByTitle = (title: string): (DesignArtifact & { kind: 'html' }) | undefined => {
    const matches = htmlArtifacts.filter((item) => fuzzyTitleMatch(title, item.title))
    return matches.length === 1 ? matches[0] : undefined
  }
  const out: PrototypePlayerLink[] = []
  const seen = new Set<string>()
  for (const link of artifact.prototypeLinks ?? []) {
    const target =
      (link.targetArtifactId ? artifactsById.get(link.targetArtifactId) : undefined) ??
      uniqueExactArtifactByTitle(link.targetTitle) ??
      uniqueFuzzyArtifactByTitle(link.targetTitle)
    if (!target || target.kind !== 'html' || target.id === artifact.id || seen.has(target.id)) continue
    seen.add(target.id)
    out.push({
      ...link,
      targetArtifactId: target.id,
      targetTitle: target.title,
      targetRelativePath: target.relativePath
    })
  }
  for (const target of htmlArtifacts) {
    if (target.id === artifact.id || seen.has(target.id)) continue
    seen.add(target.id)
    out.push({
      targetTitle: target.title,
      targetArtifactId: target.id,
      targetRelativePath: target.relativePath,
      href: buildRelativePrototypeHref(artifact.relativePath, target.relativePath),
      label: target.title
    })
  }
  return out
}
