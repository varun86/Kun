import { describe, expect, it, vi } from 'vitest'
import {
  buildPrototypeNavigationCaptureScript,
  extractPrototypeHashRouteHref,
  extractPrototypeNavigationHref,
  hasPrototypePlayback,
  isPrototypeBackNavigation,
  prototypeBackNavigationSteps,
  prototypeMissingScreenPromptValues,
  prototypePlayerGoBack,
  prototypePlayerNavigateTo,
  resolveInitialPrototypeArtifactId,
  resolvePreferredPrototypeArtifactId,
  resolvePrototypeNavigationTarget,
  resolvePrototypeLinks,
  resolvePrototypeScreens,
  resolvePrototypeViewportFrame,
  suggestedPrototypeScreenTitleFromHref,
  shouldInitializePrototypePlayerCurrentId,
  shouldCapturePrototypeNavigationHref
} from './prototype-player'
import type { DesignArtifact } from './design-types'

const now = '2026-06-29T00:00:00.000Z'

function artifact(id: string, title: string, extra: Partial<DesignArtifact> = {}): DesignArtifact {
  const relativePath = `.kun-design/doc/${id}/v1.html`
  return {
    id,
    kind: 'html',
    title,
    relativePath,
    createdAt: now,
    updatedAt: now,
    versions: [{ id: `${id}-v1`, relativePath, createdAt: now, summary: '' }],
    ...extra
  }
}

type PrototypeCaptureEvent = {
  target: unknown
  key?: string
  submitter?: unknown
  preventDefault: () => void
  stopPropagation: () => void
}

type PrototypeCaptureListener = (event: PrototypeCaptureEvent) => void
type PrototypeCaptureListeners = Partial<Record<'click' | 'keydown' | 'submit', PrototypeCaptureListener>>
type PrototypeHistoryMethod = (state: unknown, title: string, url?: string | URL | null) => unknown

function withInjectedPrototypeCapture<T>(
  script: string,
  baseURI: string,
  run: (ctx: {
    fakeWindow: {
      location: { hash: string }
      open: ReturnType<typeof vi.fn>
      history: {
        pushState: PrototypeHistoryMethod
        replaceState: PrototypeHistoryMethod
        back: () => unknown
        go: (delta?: number) => unknown
      }
    }
    listeners: PrototypeCaptureListeners
  }) => T,
  options: { anchorIds?: readonly string[]; anchorNames?: readonly string[] } = {}
): T {
  const originalWindow = (globalThis as { window?: unknown }).window
  const originalDocument = (globalThis as { document?: unknown }).document
  const originalNode = (globalThis as { Node?: unknown }).Node
  const listeners: PrototypeCaptureListeners = {}
  const fakeWindow = {
    location: { hash: '' },
    open: vi.fn(),
    history: {
      pushState: vi.fn(),
      replaceState: vi.fn(),
      back: vi.fn(),
      go: vi.fn()
    }
  }
  const fakeDocument = {
    baseURI,
    addEventListener(type: string, listener: unknown) {
      if (type === 'click' || type === 'keydown' || type === 'submit') {
        listeners[type] = listener as PrototypeCaptureListener
      }
    },
    getElementById(id: string) {
      return options.anchorIds?.includes(id) ? { id } : null
    },
    getElementsByName(name: string) {
      return options.anchorNames?.includes(name) ? [{ name }] : []
    }
  }
  ;(globalThis as { window?: unknown }).window = fakeWindow
  ;(globalThis as { document?: unknown }).document = fakeDocument
  ;(globalThis as { Node?: unknown }).Node = { ELEMENT_NODE: 1 }
  try {
    Function(script)()
    return run({ fakeWindow, listeners })
  } finally {
    ;(globalThis as { window?: unknown }).window = originalWindow
    ;(globalThis as { document?: unknown }).document = originalDocument
    ;(globalThis as { Node?: unknown }).Node = originalNode
  }
}

describe('prototype-player', () => {
  it('starts from the preferred HTML artifact when available', () => {
    const artifacts = [
      artifact('home', 'Home'),
      artifact('signup', 'Signup', { prototypeLinks: [{ targetTitle: 'Home', targetArtifactId: 'home' }] })
    ]

    expect(resolveInitialPrototypeArtifactId(artifacts, 'home')).toBe('home')
  })

  it('otherwise starts from the first linked HTML artifact, then first HTML artifact', () => {
    expect(resolveInitialPrototypeArtifactId([artifact('home', 'Home'), artifact('flow', 'Flow', {
      prototypeLinks: [{ targetTitle: 'Home', targetArtifactId: 'home' }]
    })])).toBe('flow')
    expect(resolveInitialPrototypeArtifactId([artifact('home', 'Home')])).toBe('home')
    expect(resolveInitialPrototypeArtifactId([{ ...artifact('board', 'Board'), kind: 'canvas' }])).toBeNull()
  })

  it('lists only HTML artifacts for the prototype screen map', () => {
    expect(resolvePrototypeScreens([
      artifact('home', 'Home', { relativePath: '.kun-design/doc/home/v1.html' }),
      { ...artifact('board', 'Board', { relativePath: '.kun-design/doc/board.json' }), kind: 'canvas' as const },
      artifact('settings', 'Settings', { relativePath: '.kun-design/doc/settings/v1.html' })
    ])).toEqual([
      {
        id: 'home',
        title: 'Home',
        relativePath: '.kun-design/doc/home/v1.html'
      },
      {
        id: 'settings',
        title: 'Settings',
        relativePath: '.kun-design/doc/settings/v1.html'
      }
    ])
  })

  it('prefers the selected HTML screen, then the active HTML screen for opening playback', () => {
    const artifacts = [
      artifact('home', 'Home'),
      artifact('settings', 'Settings'),
      { ...artifact('board', 'Board', { relativePath: '.kun-design/doc/board.json' }), kind: 'canvas' as const }
    ]

    expect(resolvePreferredPrototypeArtifactId(artifacts, 'settings', 'home')).toBe('settings')
    expect(resolvePreferredPrototypeArtifactId(artifacts, null, 'home')).toBe('home')
    expect(resolvePreferredPrototypeArtifactId(artifacts, 'missing', 'board')).toBeNull()
  })

  it('initializes playback only on open or when the current screen is missing', () => {
    expect(
      shouldInitializePrototypePlayerCurrentId({ open: true, wasOpen: false, currentId: 'settings' })
    ).toBe(true)
    expect(
      shouldInitializePrototypePlayerCurrentId({ open: true, wasOpen: true, currentId: 'settings' })
    ).toBe(false)
    expect(
      shouldInitializePrototypePlayerCurrentId({ open: true, wasOpen: true, currentId: null })
    ).toBe(true)
    expect(
      shouldInitializePrototypePlayerCurrentId({ open: false, wasOpen: true, currentId: null })
    ).toBe(false)
  })

  it('tracks side-rail navigation history and back behavior', () => {
    const home = { currentId: 'home', history: [], missingHref: '../missing/v1.html' }
    const settings = prototypePlayerNavigateTo(home, 'settings')

    expect(settings).toEqual({
      currentId: 'settings',
      history: ['home'],
      missingHref: ''
    })
    expect(prototypePlayerNavigateTo(settings, 'settings')).toBe(settings)
    expect(prototypePlayerNavigateTo(settings, '   ')).toBe(settings)

    const checkout = prototypePlayerNavigateTo(settings, 'checkout')
    expect(checkout).toEqual({
      currentId: 'checkout',
      history: ['home', 'settings'],
      missingHref: ''
    })

    const backToSettings = prototypePlayerGoBack({ ...checkout, missingHref: '../missing/v2.html' })
    expect(backToSettings).toEqual({
      currentId: 'settings',
      history: ['home'],
      missingHref: ''
    })
    expect(prototypePlayerGoBack(checkout, 2)).toEqual({
      currentId: 'home',
      history: [],
      missingHref: ''
    })
    expect(prototypePlayerGoBack(checkout, 10)).toEqual({
      currentId: 'home',
      history: [],
      missingHref: ''
    })
    expect(prototypePlayerGoBack({ currentId: 'home', history: [], missingHref: '../missing/v3.html' })).toEqual({
      currentId: 'home',
      history: [],
      missingHref: ''
    })
  })

  it('builds missing-screen prompt values with the source HTML path', () => {
    expect(prototypeMissingScreenPromptValues(artifact('home', 'Home'), ' ../checkout/v1.html ')).toEqual({
      current: 'Home',
      href: '../checkout/v1.html',
      sourcePath: '.kun-design/doc/home/v1.html',
      suggestedTitle: 'Checkout'
    })
    expect(prototypeMissingScreenPromptValues(artifact('home', 'Home'), '   ')).toBeNull()
    expect(
      prototypeMissingScreenPromptValues(
        { ...artifact('board', 'Board', { relativePath: '.kun-design/doc/board.json' }), kind: 'canvas' },
        '../checkout/v1.html'
      )
    ).toBeNull()
  })

  it('suggests missing-screen titles from prototype hrefs', () => {
    expect(suggestedPrototypeScreenTitleFromHref('../checkout/v1.html')).toBe('Checkout')
    expect(suggestedPrototypeScreenTitleFromHref('/account-settings')).toBe('Account Settings')
    expect(suggestedPrototypeScreenTitleFromHref('#/billing-history')).toBe('Billing History')
    expect(suggestedPrototypeScreenTitleFromHref('Signup')).toBe('Signup')
    expect(suggestedPrototypeScreenTitleFromHref('.kun-design/doc/APIKeys/index.html')).toBe('API Keys')
    expect(suggestedPrototypeScreenTitleFromHref('   ')).toBe('New screen')
  })

  it('resolves prototype playback viewport from current target when no explicit frame exists', () => {
    expect(resolvePrototypeViewportFrame(artifact('home', 'Home'))).toEqual({
      width: 1280,
      height: 800,
      orientation: 'landscape'
    })
    expect(resolvePrototypeViewportFrame(artifact('home', 'Home'), 'app')).toEqual({
      width: 390,
      height: 844,
      orientation: 'portrait'
    })
  })

  it('treats implicit preview-card nodes as target defaults for playback', () => {
    const screen = artifact('home', 'Home', {
      node: { x: 160, y: 150, width: 300, height: 640, sizeMode: 'auto' }
    })

    expect(resolvePrototypeViewportFrame(screen, 'app')).toEqual({
      width: 390,
      height: 844,
      orientation: 'portrait'
    })
  })

  it('retargets auto screen frames that still match another target default', () => {
    const previousWebDefault = artifact('home', 'Home', {
      node: { x: 80, y: 120, width: 1280, height: 800, sizeMode: 'auto' }
    })
    const previousAppDefault = artifact('home', 'Home', {
      node: { x: 80, y: 120, width: 390, height: 844, sizeMode: 'auto' }
    })
    const manualWebSized = artifact('home', 'Home', {
      node: { x: 80, y: 120, width: 1280, height: 800, sizeMode: 'manual' }
    })

    expect(resolvePrototypeViewportFrame(previousWebDefault, 'app')).toEqual({
      width: 390,
      height: 844,
      orientation: 'portrait'
    })
    expect(resolvePrototypeViewportFrame(previousAppDefault, 'web')).toEqual({
      width: 1280,
      height: 800,
      orientation: 'landscape'
    })
    expect(resolvePrototypeViewportFrame(manualWebSized, 'app')).toEqual({
      width: 1280,
      height: 800,
      orientation: 'landscape'
    })
  })

  it('respects manually sized prototype frames during playback', () => {
    const screen = artifact('kiosk', 'Kiosk', {
      node: { x: 20, y: 40, width: 1024, height: 1366, sizeMode: 'manual' }
    })

    expect(resolvePrototypeViewportFrame(screen, 'web')).toEqual({
      width: 1024,
      height: 1366,
      orientation: 'portrait'
    })
  })

  it('enables playback for any HTML artifact, including single-screen prototypes', () => {
    expect(hasPrototypePlayback([
      artifact('home', 'Home', { prototypeLinks: [{ targetTitle: 'Signup' }] }),
      artifact('signup', 'Signup')
    ])).toBe(true)
    expect(hasPrototypePlayback([
      artifact('home', 'Home'),
      artifact('signup', 'Signup')
    ])).toBe(true)
    expect(hasPrototypePlayback([
      artifact('home', 'Home', { prototypeLinks: [{ targetTitle: 'Missing' }] })
    ])).toBe(true)
    expect(hasPrototypePlayback([
      artifact('home', 'Home', { prototypeLinks: [{ targetTitle: 'Home', targetArtifactId: 'home' }] })
    ])).toBe(true)
    expect(hasPrototypePlayback([
      { ...artifact('board', 'Board', { relativePath: '.kun-design/doc/board.json' }), kind: 'canvas' as const }
    ])).toBe(false)
  })

  it('resolves links by id or normalized title and drops duplicate/self/missing targets', () => {
    const home = artifact('home', 'Home', {
      prototypeLinks: [
        { targetTitle: 'Signup', targetArtifactId: 'signup', label: 'Start trial' },
        { targetTitle: '  DASHBOARD  ' },
        { targetTitle: 'Dashboard' },
        { targetTitle: 'Home', targetArtifactId: 'home' },
        { targetTitle: 'Missing' }
      ]
    })
    const links = resolvePrototypeLinks(home, [
      home,
      artifact('signup', 'Signup'),
      artifact('dashboard', 'Dashboard')
    ])

    expect(links).toEqual([
      expect.objectContaining({
        targetArtifactId: 'signup',
        targetTitle: 'Signup',
        label: 'Start trial'
      }),
      expect.objectContaining({
        targetArtifactId: 'dashboard',
        targetTitle: 'Dashboard'
      })
    ])
  })

  it('resolves metadata links through a unique fuzzy page title match', () => {
    const home = artifact('home', 'Home', {
      prototypeLinks: [
        { targetTitle: 'Stats', label: 'Review stats' },
        { targetTitle: 'Settings' }
      ]
    })
    const links = resolvePrototypeLinks(home, [
      home,
      artifact('stats', 'Weekly Stats'),
      artifact('settings', 'Account Settings')
    ])

    expect(links).toEqual([
      expect.objectContaining({
        targetArtifactId: 'stats',
        targetTitle: 'Weekly Stats',
        label: 'Review stats'
      }),
      expect.objectContaining({
        targetArtifactId: 'settings',
        targetTitle: 'Account Settings'
      })
    ])
  })

  it('does not resolve metadata links through ambiguous fuzzy page titles', () => {
    const home = artifact('home', 'Home', {
      prototypeLinks: [{ targetTitle: 'Stats' }]
    })
    const links = resolvePrototypeLinks(home, [
      home,
      artifact('weekly', 'Weekly Stats'),
      artifact('monthly', 'Monthly Stats')
    ])

    expect(links.map((link) => link.targetArtifactId)).toEqual(['weekly', 'monthly'])
  })

  it('does not resolve metadata links through duplicate exact page titles', () => {
    const home = artifact('home', 'Home', {
      prototypeLinks: [{ targetTitle: 'Settings' }]
    })
    const links = resolvePrototypeLinks(home, [
      home,
      artifact('account-settings', 'Settings'),
      artifact('project-settings', 'Settings')
    ])

    expect(links).toEqual([
      expect.objectContaining({
        targetArtifactId: 'account-settings',
        href: '../account-settings/v1.html',
        label: 'Settings'
      }),
      expect.objectContaining({
        targetArtifactId: 'project-settings',
        href: '../project-settings/v1.html',
        label: 'Settings'
      })
    ])
  })

  it('synthesizes fallback links to sibling HTML pages when metadata is missing', () => {
    const home = artifact('home', 'Home', { relativePath: '.kun-design/doc/home/v1.html' })
    const signup = artifact('signup', 'Signup', { relativePath: '.kun-design/doc/signup/v1.html' })
    const dashboard = artifact('dashboard', 'Dashboard', { relativePath: '.kun-design/doc/dashboard/v1.html' })

    expect(resolvePrototypeLinks(home, [home, signup, dashboard])).toEqual([
      {
        targetArtifactId: 'signup',
        targetTitle: 'Signup',
        targetRelativePath: '.kun-design/doc/signup/v1.html',
        href: '../signup/v1.html',
        label: 'Signup'
      },
      {
        targetArtifactId: 'dashboard',
        targetTitle: 'Dashboard',
        targetRelativePath: '.kun-design/doc/dashboard/v1.html',
        href: '../dashboard/v1.html',
        label: 'Dashboard'
      }
    ])
  })

  it('keeps explicit prototype links first and appends fallback sibling pages', () => {
    const home = artifact('home', 'Home', {
      prototypeLinks: [{ targetTitle: 'Signup', targetArtifactId: 'signup', label: 'Start trial' }]
    })
    const signup = artifact('signup', 'Signup')
    const dashboard = artifact('dashboard', 'Dashboard')

    expect(resolvePrototypeLinks(home, [home, signup, dashboard])).toEqual([
      expect.objectContaining({
        targetArtifactId: 'signup',
        label: 'Start trial'
      }),
      expect.objectContaining({
        targetArtifactId: 'dashboard',
        href: '../dashboard/v1.html',
        label: 'Dashboard'
      })
    ])
  })

  it('resolves prototype navigation from captured href hashes or absolute urls', () => {
    const home = artifact('home', 'Home', {
      prototypeLinks: [
        {
          targetTitle: 'Signup',
          targetArtifactId: 'signup',
          href: '../signup/v1.html',
          label: 'Start trial'
        }
      ]
    })
    const links = resolvePrototypeLinks(home, [home, artifact('signup', 'Signup')])
    const currentFileUrl = 'file:///workspace/.kun-design/doc/home/v1.html'

    expect(
      resolvePrototypeNavigationTarget(
        'file:///workspace/.kun-design/doc/home/v1.html#kun-proto-nav=..%2Fsignup%2Fv1.html',
        currentFileUrl,
        links
      )?.targetArtifactId
    ).toBe('signup')
    expect(
      resolvePrototypeNavigationTarget(
        'file:///workspace/.kun-design/doc/signup/v1.html?rev=2',
        currentFileUrl,
        links
      )?.targetArtifactId
    ).toBe('signup')
    expect(resolvePrototypeNavigationTarget('https://example.com', currentFileUrl, links)).toBeNull()
  })

  it('resolves captured workspace-relative paths through fallback sibling links', () => {
    const home = artifact('home', 'Home', { relativePath: '.kun-design/doc/home/v1.html' })
    const signup = artifact('signup', 'Signup', { relativePath: '.kun-design/doc/signup/v1.html' })
    const links = resolvePrototypeLinks(home, [home, signup])
    const currentFileUrl = 'file:///workspace/.kun-design/doc/home/v1.html'

    expect(
      resolvePrototypeNavigationTarget(
        'file:///workspace/.kun-design/doc/home/v1.html#kun-proto-nav=.kun-design%2Fdoc%2Fsignup%2Fv1.html',
        currentFileUrl,
        links
      )?.targetArtifactId
    ).toBe('signup')
    expect(
      resolvePrototypeNavigationTarget(
        'file:///workspace/.kun-design/doc/home/v1.html#kun-proto-nav=%2Fsignup%2Fv1.html%3Ffrom%3Dhome',
        currentFileUrl,
        links
      )?.targetArtifactId
    ).toBe('signup')
    expect(
      resolvePrototypeNavigationTarget(
        'file:///workspace/.kun-design/doc/home/v1.html#kun-proto-nav=signup%2Fv1.html',
        currentFileUrl,
        links
      )?.targetArtifactId
    ).toBe('signup')
  })

  it('resolves captured prototype target titles to sibling pages', () => {
    const home = artifact('home', 'Home')
    const signup = artifact('signup', 'Signup')
    const links = resolvePrototypeLinks(home, [home, signup])
    const currentFileUrl = 'file:///workspace/.kun-design/doc/home/v1.html'

    expect(
      resolvePrototypeNavigationTarget(
        'file:///workspace/.kun-design/doc/home/v1.html#kun-proto-nav=Signup',
        currentFileUrl,
        links
      )?.targetArtifactId
    ).toBe('signup')
    expect(
      resolvePrototypeNavigationTarget(
        'file:///workspace/.kun-design/doc/home/v1.html#kun-proto-nav=%20%20signup%20%20',
        currentFileUrl,
        links
      )?.targetArtifactId
    ).toBe('signup')
  })

  it('resolves plain hash target titles to sibling pages when they are unique', () => {
    const home = artifact('home', 'Home')
    const checkout = artifact('checkout', 'Checkout')
    const accountSettings = artifact('account-settings', 'Account Settings')
    const links = resolvePrototypeLinks(home, [home, checkout, accountSettings])
    const currentFileUrl = 'file:///workspace/.kun-design/doc/home/v1.html'

    expect(
      resolvePrototypeNavigationTarget(
        'file:///workspace/.kun-design/doc/home/v1.html#Checkout',
        currentFileUrl,
        links
      )?.targetArtifactId
    ).toBe('checkout')
    expect(
      resolvePrototypeNavigationTarget(
        'file:///workspace/.kun-design/doc/home/v1.html#account-settings',
        currentFileUrl,
        links
      )?.targetArtifactId
    ).toBe('account-settings')
  })

  it('does not resolve captured target titles when multiple links share the same title', () => {
    const home = artifact('home', 'Home')
    const links = resolvePrototypeLinks(home, [
      home,
      artifact('account-settings', 'Settings'),
      artifact('project-settings', 'Settings')
    ])

    expect(
      resolvePrototypeNavigationTarget(
        'file:///workspace/.kun-design/doc/home/v1.html#kun-proto-nav=Settings',
        'file:///workspace/.kun-design/doc/home/v1.html',
        links
      )
    ).toBeNull()
  })

  it('resolves captured target titles through a unique fuzzy match', () => {
    const home = artifact('home', 'Home')
    const links = resolvePrototypeLinks(home, [
      home,
      artifact('stats', 'Weekly Stats'),
      artifact('settings', 'Account Settings')
    ])
    const currentFileUrl = 'file:///workspace/.kun-design/doc/home/v1.html'

    expect(
      resolvePrototypeNavigationTarget(
        'file:///workspace/.kun-design/doc/home/v1.html#kun-proto-nav=Stats',
        currentFileUrl,
        links
      )?.targetArtifactId
    ).toBe('stats')
    expect(
      resolvePrototypeNavigationTarget(
        'file:///workspace/.kun-design/doc/home/v1.html#kun-proto-nav=Account',
        currentFileUrl,
        links
      )?.targetArtifactId
    ).toBe('settings')
  })

  it('does not resolve captured target titles through ambiguous fuzzy matches', () => {
    const home = artifact('home', 'Home')
    const links = resolvePrototypeLinks(home, [
      home,
      artifact('weekly', 'Weekly Stats'),
      artifact('monthly', 'Monthly Stats')
    ])

    expect(
      resolvePrototypeNavigationTarget(
        'file:///workspace/.kun-design/doc/home/v1.html#kun-proto-nav=Stats',
        'file:///workspace/.kun-design/doc/home/v1.html',
        links
      )
    ).toBeNull()
  })

  it('resolves route-style prototype href slugs to unique sibling pages', () => {
    const home = artifact('home', 'Home')
    const settings = artifact('settings', 'Account Settings', {
      relativePath: '.kun-design/doc/account-settings/v1.html'
    })
    const stats = artifact('weekly-stats', 'Weekly Stats', {
      relativePath: '.kun-design/doc/weekly-stats/v1.html'
    })
    const links = resolvePrototypeLinks(home, [home, settings, stats])
    const currentFileUrl = 'file:///workspace/.kun-design/doc/home/v1.html'

    expect(
      resolvePrototypeNavigationTarget(
        'file:///workspace/.kun-design/doc/home/v1.html#kun-proto-nav=%2Fsettings',
        currentFileUrl,
        links
      )?.targetArtifactId
    ).toBe('settings')
    expect(
      resolvePrototypeNavigationTarget(
        'file:///workspace/.kun-design/doc/home/v1.html#kun-proto-nav=..%2Faccount-settings%2F',
        currentFileUrl,
        links
      )?.targetArtifactId
    ).toBe('settings')
    expect(
      resolvePrototypeNavigationTarget('/weekly-stats?from=home', currentFileUrl, links)?.targetArtifactId
    ).toBe('weekly-stats')
    expect(
      resolvePrototypeNavigationTarget(
        'file:///workspace/.kun-design/doc/home/v1.html#/settings',
        currentFileUrl,
        links
      )?.targetArtifactId
    ).toBe('settings')
    expect(
      resolvePrototypeNavigationTarget(
        'file:///workspace/.kun-design/doc/home/v1.html#kun-proto-nav=%23%2Fweekly-stats',
        currentFileUrl,
        links
      )?.targetArtifactId
    ).toBe('weekly-stats')
  })

  it('does not resolve ambiguous route-style prototype href slugs', () => {
    const home = artifact('home', 'Home')
    const links = resolvePrototypeLinks(home, [
      home,
      artifact('account-settings', 'Account Settings'),
      artifact('project-settings', 'Project Settings')
    ])

    expect(
      resolvePrototypeNavigationTarget(
        'file:///workspace/.kun-design/doc/home/v1.html#kun-proto-nav=%2Fsettings',
        'file:///workspace/.kun-design/doc/home/v1.html',
        links
      )
    ).toBeNull()
  })

  it('does not resolve ambiguous bare filenames to sibling prototype pages', () => {
    const home = artifact('home', 'Home', { relativePath: '.kun-design/doc/home/v1.html' })
    const signup = artifact('signup', 'Signup', { relativePath: '.kun-design/doc/signup/v1.html' })
    const settings = artifact('settings', 'Settings', { relativePath: '.kun-design/doc/settings/v1.html' })
    const links = resolvePrototypeLinks(home, [home, signup, settings])

    expect(
      resolvePrototypeNavigationTarget(
        'file:///workspace/.kun-design/doc/home/v1.html#kun-proto-nav=v1.html',
        'file:///workspace/.kun-design/doc/home/v1.html',
        links
      )
    ).toBeNull()
  })

  it('does not resolve ambiguous short relative paths to the first matching page', () => {
    const home = artifact('home', 'Home', { relativePath: '.kun-design/doc/home/v1.html' })
    const accountSettings = artifact('account-settings', 'Account Settings', {
      relativePath: '.kun-design/doc/account/settings/v1.html'
    })
    const projectSettings = artifact('project-settings', 'Project Settings', {
      relativePath: '.kun-design/doc/project/settings/v1.html'
    })
    const links = resolvePrototypeLinks(home, [home, accountSettings, projectSettings])

    expect(
      resolvePrototypeNavigationTarget(
        'file:///workspace/.kun-design/doc/home/v1.html#kun-proto-nav=settings%2Fv1.html',
        'file:///workspace/.kun-design/doc/home/v1.html',
        links
      )
    ).toBeNull()
  })

  it('extracts captured prototype hrefs and leaves ordinary hashes alone', () => {
    expect(extractPrototypeNavigationHref('#kun-proto-nav=..%2Fsignup%2Fv1.html')).toBe('../signup/v1.html')
    expect(extractPrototypeNavigationHref('file:///x.html#section')).toBeNull()
  })

  it('detects captured prototype back navigation signals', () => {
    expect(isPrototypeBackNavigation('#kun-proto-back=123')).toBe(true)
    expect(isPrototypeBackNavigation('file:///workspace/home.html#kun-proto-back=123')).toBe(true)
    expect(isPrototypeBackNavigation('#kun-proto-nav=..%2Fsignup%2Fv1.html')).toBe(false)
    expect(isPrototypeBackNavigation('#/settings')).toBe(false)
    expect(prototypeBackNavigationSteps('#kun-proto-back=123')).toBe(1)
    expect(prototypeBackNavigationSteps('#kun-proto-back=steps%3D2%26t%3D99')).toBe(2)
    expect(prototypeBackNavigationSteps('file:///workspace/home.html#kun-proto-back=steps%3D3%26t%3D99')).toBe(3)
    expect(prototypeBackNavigationSteps('#kun-proto-nav=..%2Fsignup%2Fv1.html')).toBeNull()
  })

  it('extracts hash-route prototype hrefs without treating plain anchors as routes', () => {
    expect(extractPrototypeHashRouteHref('#/settings')).toBe('/settings')
    expect(extractPrototypeHashRouteHref('#!/settings')).toBe('/settings')
    expect(extractPrototypeHashRouteHref('#..%2Fsettings%2Fv1.html')).toBe('../settings/v1.html')
    expect(extractPrototypeHashRouteHref('file:///workspace/home.html#/settings')).toBe('/settings')
    expect(extractPrototypeHashRouteHref('#settings')).toBeNull()
    expect(extractPrototypeHashRouteHref('#/assets/logo.png')).toBeNull()
    expect(extractPrototypeHashRouteHref('#kun-proto-nav=..%2Fsettings%2Fv1.html')).toBeNull()
  })

  it('captures unknown local prototype hrefs but lets anchors and external links behave normally', () => {
    const base = 'file:///workspace/.kun-design/doc/home/v1.html'

    expect(shouldCapturePrototypeNavigationHref('../billing/v1.html', base)).toBe(true)
    expect(shouldCapturePrototypeNavigationHref('/settings', base)).toBe(true)
    expect(shouldCapturePrototypeNavigationHref('#/settings', base)).toBe(true)
    expect(shouldCapturePrototypeNavigationHref('#../settings/v1.html', base)).toBe(true)
    expect(shouldCapturePrototypeNavigationHref('file:///workspace/proto/settings', base)).toBe(true)
    expect(shouldCapturePrototypeNavigationHref('/workspace/proto/settings.html', base)).toBe(true)
    expect(shouldCapturePrototypeNavigationHref('file:///workspace/proto/settings.html', base)).toBe(true)
    expect(shouldCapturePrototypeNavigationHref('#pricing', base)).toBe(false)
    expect(shouldCapturePrototypeNavigationHref('#/assets/logo.png', base)).toBe(false)
    expect(shouldCapturePrototypeNavigationHref('?tab=settings', base)).toBe(false)
    expect(shouldCapturePrototypeNavigationHref('mailto:hello@example.com', base)).toBe(false)
    expect(shouldCapturePrototypeNavigationHref('../assets/logo.png', base)).toBe(false)
    expect(shouldCapturePrototypeNavigationHref('/styles/app.css', base)).toBe(false)
    expect(shouldCapturePrototypeNavigationHref('file:///workspace/proto/report.pdf', base)).toBe(false)
    expect(shouldCapturePrototypeNavigationHref('https://example.com/demo', base)).toBe(false)
  })

  it('builds a capture script scoped to known flow hrefs', () => {
    const script = buildPrototypeNavigationCaptureScript([
      {
        targetTitle: 'Signup',
        targetArtifactId: 'signup',
        href: '../signup/v1.html'
      }
    ])

    expect(script).toContain('../signup/v1.html')
    expect(script).toContain('kun-proto-nav=')
    expect(script).toContain('allowed.add')
    expect(script).toContain('const currentAllowed')
    expect(script).toContain('window[key] instanceof Set')
    expect(script).toContain('__kunPrototypeNavCaptureTitles')
    expect(script).toContain('targetTitles')
    expect(script).toContain('fuzzyTitleMatch')
    expect(script).toContain('hasUniqueFuzzyTargetTitle')
    expect(script).toContain('currentTitleAllowed()')
    expect(script).toContain('isKnownTargetTitle')
    expect(script).toContain('hrefFromElement')
    expect(script).toContain('shouldNavigateElement')
    expect(script).toContain('const liveAllowed = currentAllowed()')
    expect(script).toContain('liveAllowed.has(raw)')
    expect(script).toContain('__kunPrototypeOriginalOpen')
    expect(script).toContain('__kunPrototypeWindowOpenPatched')
    expect(script).toContain('window.open = function(url, target, features)')
    expect(script).toContain("navigate(raw, { preventDefault() {}, stopPropagation() {} })")
    expect(script).toContain('__kunPrototypeOriginalPushState')
    expect(script).toContain('__kunPrototypePushStatePatched')
    expect(script).toContain("patchHistoryMethod('pushState'")
    expect(script).toContain("patchHistoryMethod('replaceState'")
    expect(script).toContain('kun-proto-back=')
    expect(script).toContain('__kunPrototypeBackPatched')
    expect(script).toContain('window.history.back = function()')
    expect(script).toContain('window.history.go = function(delta)')
    expect(script).toContain('backStepsFromInlineHandler')
    expect(script).toContain("'steps=' + count")
    expect(script).toContain('signalBackFromElement')
    expect(script).toContain('shouldCapture')
    expect(script).toContain('hashRouteHref')
    expect(script).toContain('plainHashTargetTitle')
    expect(script).toContain('hasSamePageAnchor')
    expect(script).toContain("const navHref = raw.startsWith('#') ? (hashRouteHref(raw) || plainHashTargetTitle(raw)) : raw")
    expect(script).toContain("encodeURIComponent(navHref)")
    expect(script).toContain('isPageLikePrototypePath')
    expect(script.indexOf("el.getAttribute('data-prototype-href')")).toBeLessThan(
      script.indexOf("el.getAttribute('href')")
    )
    expect(script).toContain('[data-prototype-target]')
    expect(script).toContain("[data-target]")
    expect(script).toContain('[onclick]')
    expect(script).toContain('hrefFromInlineHandler')
    expect(script).toContain("document.addEventListener('keydown'")
    expect(script).toContain("event.key !== 'Enter' && event.key !== ' '")
    expect(script).toContain('/^(?:a|button|input|select|textarea)$/i.test(el.tagName)')
    expect(script).toContain("submitter.getAttribute('data-prototype-target')")
    expect(script).toContain("submitter.getAttribute('data-target')")
    expect(script).toContain('looksLikePrototypePath')
    expect(script).toContain("event.target.matches('form')")
    expect(script).toContain("getAttribute('action')")
    expect(script).toContain("hrefFromInlineHandler(form.getAttribute('onsubmit'))")
    expect(script).toContain("document.addEventListener('submit'")
    expect(script).toContain('event.submitter')
  })

  it('captures history.pushState prototype navigation from scripted routers', () => {
    const currentFileUrl = 'file:///workspace/.kun-design/doc/home/v1.html'
    const home = artifact('home', 'Home')
    const checkout = artifact('checkout', 'Checkout')
    const links = resolvePrototypeLinks(home, [home, checkout])
    withInjectedPrototypeCapture(
      buildPrototypeNavigationCaptureScript(links),
      currentFileUrl,
      ({ fakeWindow }) => {
        fakeWindow.history.pushState({}, '', '../checkout/v1.html')

        expect(fakeWindow.location.hash).toBe('kun-proto-nav=..%2Fcheckout%2Fv1.html')
        expect(
          resolvePrototypeNavigationTarget(
            `${currentFileUrl}#${fakeWindow.location.hash}`,
            currentFileUrl,
            links
          )?.targetArtifactId
        ).toBe('checkout')
      }
    )
  })

  it('captures history.back and history.go(-1) prototype navigation from scripted routers', () => {
    withInjectedPrototypeCapture(
      buildPrototypeNavigationCaptureScript([]),
      'file:///workspace/.kun-design/doc/settings/v1.html',
      ({ fakeWindow }) => {
        fakeWindow.history.back()
        expect(fakeWindow.location.hash).toMatch(/^kun-proto-back=/)

        fakeWindow.location.hash = ''
        fakeWindow.history.go(-1)
        expect(fakeWindow.location.hash).toMatch(/^kun-proto-back=steps%3D1%26t%3D/)

        fakeWindow.location.hash = ''
        fakeWindow.history.go(-2)
        expect(fakeWindow.location.hash).toMatch(/^kun-proto-back=steps%3D2%26t%3D/)

        fakeWindow.location.hash = ''
        fakeWindow.history.go(1)
        expect(fakeWindow.location.hash).toBe('')
      }
    )
  })

  it('captures button hash routes in the injected navigation script', () => {
    withInjectedPrototypeCapture(
      buildPrototypeNavigationCaptureScript([
        { targetTitle: 'Signup', targetArtifactId: 'signup', href: '../signup/v1.html' }
      ]),
      'file:///workspace/.kun-design/doc/home/v1.html',
      ({ fakeWindow, listeners }) => {
        const button = {
          nodeType: 1,
          tagName: 'BUTTON',
          parentElement: null,
          hasAttribute(name: string) {
            return name === 'data-href'
          },
          getAttribute(name: string) {
            return name === 'data-href' ? '#/signup' : null
          },
          closest() {
            return this
          }
        }
        const event = {
          target: button,
          preventDefault: vi.fn(),
          stopPropagation: vi.fn()
        }
        const listener = listeners.click
        expect(listener).toBeTypeOf('function')
        if (!listener) throw new Error('Expected injected click listener to be installed')
        listener(event)

        expect(event.preventDefault).toHaveBeenCalled()
        expect(event.stopPropagation).toHaveBeenCalled()
        expect(fakeWindow.location.hash).toBe('kun-proto-nav=%2Fsignup')
      }
    )
  })

  it('captures plain hash links when they uniquely match a prototype screen', () => {
    const currentFileUrl = 'file:///workspace/.kun-design/doc/home/v1.html'
    const home = artifact('home', 'Home')
    const checkout = artifact('checkout', 'Checkout')
    const links = resolvePrototypeLinks(home, [home, checkout])
    withInjectedPrototypeCapture(
      buildPrototypeNavigationCaptureScript(links),
      currentFileUrl,
      ({ fakeWindow, listeners }) => {
        const link = {
          nodeType: 1,
          tagName: 'A',
          parentElement: null,
          hasAttribute(name: string) {
            return name === 'href'
          },
          getAttribute(name: string) {
            return name === 'href' ? '#Checkout' : null
          },
          closest() {
            return this
          }
        }
        const event = {
          target: link,
          preventDefault: vi.fn(),
          stopPropagation: vi.fn()
        }
        const listener = listeners.click
        expect(listener).toBeTypeOf('function')
        if (!listener) throw new Error('Expected injected click listener to be installed')
        listener(event)

        expect(event.preventDefault).toHaveBeenCalled()
        expect(event.stopPropagation).toHaveBeenCalled()
        expect(fakeWindow.location.hash).toBe('kun-proto-nav=Checkout')
        expect(
          resolvePrototypeNavigationTarget(
            `${currentFileUrl}#${fakeWindow.location.hash}`,
            currentFileUrl,
            links
          )?.targetArtifactId
        ).toBe('checkout')
      }
    )
  })

  it('lets real same-page hash anchors behave normally in the injected navigation script', () => {
    const currentFileUrl = 'file:///workspace/.kun-design/doc/home/v1.html'
    const home = artifact('home', 'Home')
    const checkout = artifact('checkout', 'Checkout')
    const links = resolvePrototypeLinks(home, [home, checkout])
    withInjectedPrototypeCapture(
      buildPrototypeNavigationCaptureScript(links),
      currentFileUrl,
      ({ fakeWindow, listeners }) => {
        const link = {
          nodeType: 1,
          tagName: 'A',
          parentElement: null,
          hasAttribute(name: string) {
            return name === 'href'
          },
          getAttribute(name: string) {
            return name === 'href' ? '#Checkout' : null
          },
          closest() {
            return this
          }
        }
        const event = {
          target: link,
          preventDefault: vi.fn(),
          stopPropagation: vi.fn()
        }
        const listener = listeners.click
        expect(listener).toBeTypeOf('function')
        if (!listener) throw new Error('Expected injected click listener to be installed')
        listener(event)

        expect(event.preventDefault).not.toHaveBeenCalled()
        expect(event.stopPropagation).not.toHaveBeenCalled()
        expect(fakeWindow.location.hash).toBe('')
      },
      { anchorIds: ['Checkout'] }
    )
  })

  it('captures page-title targets and resolves them to a prototype screen', () => {
    const currentFileUrl = 'file:///workspace/.kun-design/doc/home/v1.html'
    const home = artifact('home', 'Home')
    const signup = artifact('signup', 'Signup')
    const links = resolvePrototypeLinks(home, [home, signup])
    withInjectedPrototypeCapture(
      buildPrototypeNavigationCaptureScript(links),
      currentFileUrl,
      ({ fakeWindow, listeners }) => {
        const button = {
          nodeType: 1,
          tagName: 'BUTTON',
          parentElement: null,
          hasAttribute(name: string) {
            return name === 'data-prototype-target'
          },
          getAttribute(name: string) {
            return name === 'data-prototype-target' ? 'Signup' : null
          },
          closest() {
            return this
          }
        }
        const event = {
          target: button,
          preventDefault: vi.fn(),
          stopPropagation: vi.fn()
        }
        const listener = listeners.click
        expect(listener).toBeTypeOf('function')
        if (!listener) throw new Error('Expected injected click listener to be installed')
        listener(event)

        expect(event.preventDefault).toHaveBeenCalled()
        expect(event.stopPropagation).toHaveBeenCalled()
        expect(fakeWindow.location.hash).toBe('kun-proto-nav=Signup')
        expect(
          resolvePrototypeNavigationTarget(
            `${currentFileUrl}#${fakeWindow.location.hash}`,
            currentFileUrl,
            links
          )?.targetArtifactId
        ).toBe('signup')
      }
    )
  })

  it('captures keyboard activation on non-native prototype cards', () => {
    const currentFileUrl = 'file:///workspace/.kun-design/doc/home/v1.html'
    const home = artifact('home', 'Home')
    const details = artifact('details', 'Details')
    const links = resolvePrototypeLinks(home, [home, details])
    withInjectedPrototypeCapture(
      buildPrototypeNavigationCaptureScript(links),
      currentFileUrl,
      ({ fakeWindow, listeners }) => {
        const card = {
          nodeType: 1,
          tagName: 'DIV',
          parentElement: null,
          hasAttribute(name: string) {
            return name === 'data-prototype-target'
          },
          getAttribute(name: string) {
            return name === 'data-prototype-target' ? 'Details' : null
          },
          closest() {
            return this
          }
        }
        const event = {
          target: card,
          key: 'Enter',
          preventDefault: vi.fn(),
          stopPropagation: vi.fn()
        }
        const listener = listeners.keydown
        expect(listener).toBeTypeOf('function')
        if (!listener) throw new Error('Expected injected keydown listener to be installed')
        listener(event)

        expect(event.preventDefault).toHaveBeenCalled()
        expect(event.stopPropagation).toHaveBeenCalled()
        expect(fakeWindow.location.hash).toBe('kun-proto-nav=Details')
        expect(
          resolvePrototypeNavigationTarget(
            `${currentFileUrl}#${fakeWindow.location.hash}`,
            currentFileUrl,
            links
          )?.targetArtifactId
        ).toBe('details')
      }
    )
  })

  it('captures space-key activation on non-native prototype cards', () => {
    const currentFileUrl = 'file:///workspace/.kun-design/doc/home/v1.html'
    const home = artifact('home', 'Home')
    const details = artifact('details', 'Details')
    const links = resolvePrototypeLinks(home, [home, details])
    withInjectedPrototypeCapture(
      buildPrototypeNavigationCaptureScript(links),
      currentFileUrl,
      ({ fakeWindow, listeners }) => {
        const card = {
          nodeType: 1,
          tagName: 'DIV',
          parentElement: null,
          hasAttribute(name: string) {
            return name === 'data-prototype-target'
          },
          getAttribute(name: string) {
            return name === 'data-prototype-target' ? 'Details' : null
          },
          closest() {
            return this
          }
        }
        const event = {
          target: card,
          key: ' ',
          preventDefault: vi.fn(),
          stopPropagation: vi.fn()
        }
        const listener = listeners.keydown
        expect(listener).toBeTypeOf('function')
        if (!listener) throw new Error('Expected injected keydown listener to be installed')
        listener(event)

        expect(event.preventDefault).toHaveBeenCalled()
        expect(event.stopPropagation).toHaveBeenCalled()
        expect(fakeWindow.location.hash).toBe('kun-proto-nav=Details')
        expect(
          resolvePrototypeNavigationTarget(
            `${currentFileUrl}#${fakeWindow.location.hash}`,
            currentFileUrl,
            links
          )?.targetArtifactId
        ).toBe('details')
      }
    )
  })

  it('captures window.open prototype navigation calls', () => {
    const currentFileUrl = 'file:///workspace/.kun-design/doc/home/v1.html'
    const home = artifact('home', 'Home')
    const checkout = artifact('checkout', 'Checkout')
    const links = resolvePrototypeLinks(home, [home, checkout])
    withInjectedPrototypeCapture(
      buildPrototypeNavigationCaptureScript(links),
      currentFileUrl,
      ({ fakeWindow }) => {
        const originalOpen = (fakeWindow as { __kunPrototypeOriginalOpen?: ReturnType<typeof vi.fn> }).__kunPrototypeOriginalOpen
        const open = fakeWindow.open as unknown as (url?: string, target?: string, features?: string) => unknown
        const result = open('Checkout', '_blank')

        expect(result).toBeNull()
        expect(originalOpen).toBeDefined()
        expect(originalOpen).not.toHaveBeenCalled()
        expect(fakeWindow.location.hash).toBe('kun-proto-nav=Checkout')
        expect(
          resolvePrototypeNavigationTarget(
            `${currentFileUrl}#${fakeWindow.location.hash}`,
            currentFileUrl,
            links
          )?.targetArtifactId
        ).toBe('checkout')
      }
    )
  })

  it('captures inline location.href prototype navigation handlers', () => {
    const currentFileUrl = 'file:///workspace/.kun-design/doc/home/v1.html'
    const home = artifact('home', 'Home')
    const checkout = artifact('checkout', 'Checkout')
    const links = resolvePrototypeLinks(home, [home, checkout])
    withInjectedPrototypeCapture(
      buildPrototypeNavigationCaptureScript(links),
      currentFileUrl,
      ({ fakeWindow, listeners }) => {
        const button = {
          nodeType: 1,
          tagName: 'BUTTON',
          parentElement: null,
          hasAttribute(name: string) {
            return name === 'onclick'
          },
          getAttribute(name: string) {
            return name === 'onclick' ? "location.href = 'Checkout'" : null
          },
          closest() {
            return this
          }
        }
        const event = {
          target: button,
          preventDefault: vi.fn(),
          stopPropagation: vi.fn()
        }
        const listener = listeners.click
        expect(listener).toBeTypeOf('function')
        if (!listener) throw new Error('Expected injected click listener to be installed')
        listener(event)

        expect(event.preventDefault).toHaveBeenCalled()
        expect(event.stopPropagation).toHaveBeenCalled()
        expect(fakeWindow.location.hash).toBe('kun-proto-nav=Checkout')
        expect(
          resolvePrototypeNavigationTarget(
            `${currentFileUrl}#${fakeWindow.location.hash}`,
            currentFileUrl,
            links
          )?.targetArtifactId
        ).toBe('checkout')
      }
    )
  })

  it('captures inline history.back prototype navigation handlers', () => {
    withInjectedPrototypeCapture(
      buildPrototypeNavigationCaptureScript([]),
      'file:///workspace/.kun-design/doc/settings/v1.html',
      ({ fakeWindow, listeners }) => {
        const button = {
          nodeType: 1,
          tagName: 'BUTTON',
          parentElement: null,
          hasAttribute(name: string) {
            return name === 'onclick'
          },
          getAttribute(name: string) {
            return name === 'onclick' ? 'history.back()' : null
          },
          closest() {
            return this
          }
        }
        const event = {
          target: button,
          preventDefault: vi.fn(),
          stopPropagation: vi.fn()
        }
        const listener = listeners.click
        expect(listener).toBeTypeOf('function')
        if (!listener) throw new Error('Expected injected click listener to be installed')
        listener(event)

        expect(event.preventDefault).toHaveBeenCalled()
        expect(event.stopPropagation).toHaveBeenCalled()
        expect(fakeWindow.location.hash).toMatch(/^kun-proto-back=/)
      }
    )
  })

  it('captures inline history.go(-2) prototype navigation handlers with steps', () => {
    withInjectedPrototypeCapture(
      buildPrototypeNavigationCaptureScript([]),
      'file:///workspace/.kun-design/doc/settings/v1.html',
      ({ fakeWindow, listeners }) => {
        const button = {
          nodeType: 1,
          tagName: 'BUTTON',
          parentElement: null,
          hasAttribute(name: string) {
            return name === 'onclick'
          },
          getAttribute(name: string) {
            return name === 'onclick' ? 'history.go(-2)' : null
          },
          closest() {
            return this
          }
        }
        const event = {
          target: button,
          preventDefault: vi.fn(),
          stopPropagation: vi.fn()
        }
        const listener = listeners.click
        expect(listener).toBeTypeOf('function')
        if (!listener) throw new Error('Expected injected click listener to be installed')
        listener(event)

        expect(event.preventDefault).toHaveBeenCalled()
        expect(event.stopPropagation).toHaveBeenCalled()
        expect(fakeWindow.location.hash).toMatch(/^kun-proto-back=steps%3D2%26t%3D/)
      }
    )
  })

  it('captures inline location.hash prototype navigation handlers', () => {
    const currentFileUrl = 'file:///workspace/.kun-design/doc/home/v1.html'
    const home = artifact('home', 'Home')
    const checkout = artifact('checkout', 'Checkout')
    const links = resolvePrototypeLinks(home, [home, checkout])
    withInjectedPrototypeCapture(
      buildPrototypeNavigationCaptureScript(links),
      currentFileUrl,
      ({ fakeWindow, listeners }) => {
        const button = {
          nodeType: 1,
          tagName: 'BUTTON',
          parentElement: null,
          hasAttribute(name: string) {
            return name === 'onclick'
          },
          getAttribute(name: string) {
            return name === 'onclick' ? "location.hash = '#/checkout'" : null
          },
          closest() {
            return this
          }
        }
        const event = {
          target: button,
          preventDefault: vi.fn(),
          stopPropagation: vi.fn()
        }
        const listener = listeners.click
        expect(listener).toBeTypeOf('function')
        if (!listener) throw new Error('Expected injected click listener to be installed')
        listener(event)

        expect(event.preventDefault).toHaveBeenCalled()
        expect(event.stopPropagation).toHaveBeenCalled()
        expect(fakeWindow.location.hash).toBe('kun-proto-nav=%2Fcheckout')
        expect(
          resolvePrototypeNavigationTarget(
            `${currentFileUrl}#${fakeWindow.location.hash}`,
            currentFileUrl,
            links
          )?.targetArtifactId
        ).toBe('checkout')
      }
    )
  })

  it('captures form submits and resolves them to a prototype screen', () => {
    const currentFileUrl = 'file:///workspace/.kun-design/doc/home/v1.html'
    const home = artifact('home', 'Home')
    const checkout = artifact('checkout', 'Checkout')
    const links = resolvePrototypeLinks(home, [home, checkout])
    withInjectedPrototypeCapture(
      buildPrototypeNavigationCaptureScript(links),
      currentFileUrl,
      ({ fakeWindow, listeners }) => {
        const form = {
          matches() {
            return true
          },
          getAttribute(name: string) {
            return name === 'data-prototype-target' ? 'Checkout' : null
          }
        }
        const event = {
          target: form,
          submitter: null,
          preventDefault: vi.fn(),
          stopPropagation: vi.fn()
        }
        const listener = listeners.submit
        expect(listener).toBeTypeOf('function')
        if (!listener) throw new Error('Expected injected submit listener to be installed')
        listener(event)

        expect(event.preventDefault).toHaveBeenCalled()
        expect(event.stopPropagation).toHaveBeenCalled()
        expect(fakeWindow.location.hash).toBe('kun-proto-nav=Checkout')
        expect(
          resolvePrototypeNavigationTarget(
            `${currentFileUrl}#${fakeWindow.location.hash}`,
            currentFileUrl,
            links
          )?.targetArtifactId
        ).toBe('checkout')
      }
    )
  })

  it('captures form onsubmit prototype navigation handlers', () => {
    const currentFileUrl = 'file:///workspace/.kun-design/doc/home/v1.html'
    const home = artifact('home', 'Home')
    const checkout = artifact('checkout', 'Checkout')
    const links = resolvePrototypeLinks(home, [home, checkout])
    withInjectedPrototypeCapture(
      buildPrototypeNavigationCaptureScript(links),
      currentFileUrl,
      ({ fakeWindow, listeners }) => {
        const form = {
          matches() {
            return true
          },
          getAttribute(name: string) {
            return name === 'onsubmit' ? "window.location.assign('Checkout')" : null
          }
        }
        const event = {
          target: form,
          submitter: null,
          preventDefault: vi.fn(),
          stopPropagation: vi.fn()
        }
        const listener = listeners.submit
        expect(listener).toBeTypeOf('function')
        if (!listener) throw new Error('Expected injected submit listener to be installed')
        listener(event)

        expect(event.preventDefault).toHaveBeenCalled()
        expect(event.stopPropagation).toHaveBeenCalled()
        expect(fakeWindow.location.hash).toBe('kun-proto-nav=Checkout')
        expect(
          resolvePrototypeNavigationTarget(
            `${currentFileUrl}#${fakeWindow.location.hash}`,
            currentFileUrl,
            links
          )?.targetArtifactId
        ).toBe('checkout')
      }
    )
  })

  it('prefers submitter prototype targets over the form target', () => {
    const currentFileUrl = 'file:///workspace/.kun-design/doc/home/v1.html'
    const home = artifact('home', 'Home')
    const draft = artifact('draft', 'Draft')
    const checkout = artifact('checkout', 'Checkout')
    const links = resolvePrototypeLinks(home, [home, draft, checkout])
    withInjectedPrototypeCapture(
      buildPrototypeNavigationCaptureScript(links),
      currentFileUrl,
      ({ fakeWindow, listeners }) => {
        const form = {
          matches() {
            return true
          },
          getAttribute(name: string) {
            return name === 'data-prototype-target' ? 'Draft' : null
          }
        }
        const submitter = {
          getAttribute(name: string) {
            return name === 'data-prototype-target' ? 'Checkout' : null
          }
        }
        const event = {
          target: form,
          submitter,
          preventDefault: vi.fn(),
          stopPropagation: vi.fn()
        }
        const listener = listeners.submit
        expect(listener).toBeTypeOf('function')
        if (!listener) throw new Error('Expected injected submit listener to be installed')
        listener(event)

        expect(event.preventDefault).toHaveBeenCalled()
        expect(event.stopPropagation).toHaveBeenCalled()
        expect(fakeWindow.location.hash).toBe('kun-proto-nav=Checkout')
        expect(
          resolvePrototypeNavigationTarget(
            `${currentFileUrl}#${fakeWindow.location.hash}`,
            currentFileUrl,
            links
          )?.targetArtifactId
        ).toBe('checkout')
      }
    )
  })

  it('captures submitter prototype targets even when the form has no action', () => {
    const currentFileUrl = 'file:///workspace/.kun-design/doc/home/v1.html'
    const home = artifact('home', 'Home')
    const checkout = artifact('checkout', 'Checkout')
    const links = resolvePrototypeLinks(home, [home, checkout])
    withInjectedPrototypeCapture(
      buildPrototypeNavigationCaptureScript(links),
      currentFileUrl,
      ({ fakeWindow, listeners }) => {
        const form = {
          matches(selector: string) {
            return selector === 'form'
          },
          getAttribute() {
            return null
          }
        }
        const submitter = {
          getAttribute(name: string) {
            return name === 'data-prototype-target' ? 'Checkout' : null
          },
          formAction: ''
        }
        const event = {
          target: form,
          submitter,
          preventDefault: vi.fn(),
          stopPropagation: vi.fn()
        }
        const listener = listeners.submit
        expect(listener).toBeTypeOf('function')
        if (!listener) throw new Error('Expected injected submit listener to be installed')
        listener(event)

        expect(event.preventDefault).toHaveBeenCalled()
        expect(event.stopPropagation).toHaveBeenCalled()
        expect(fakeWindow.location.hash).toBe('kun-proto-nav=Checkout')
        expect(
          resolvePrototypeNavigationTarget(
            `${currentFileUrl}#${fakeWindow.location.hash}`,
            currentFileUrl,
            links
          )?.targetArtifactId
        ).toBe('checkout')
      }
    )
  })
})
