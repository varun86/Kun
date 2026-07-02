import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { DesignArtifact } from '../../../design/design-types'
import { PrototypePlayerOverlay } from './PrototypePlayerOverlay'

const now = '2026-06-30T00:00:00.000Z'

function htmlArtifact(id: string, title: string, extra: Partial<DesignArtifact> = {}): DesignArtifact {
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

describe('PrototypePlayerOverlay', () => {
  it('renders an app-target prototype shell with phone viewport and all screens', () => {
    const html = renderToStaticMarkup(
      createElement(PrototypePlayerOverlay, {
        open: true,
        workspaceRoot: '/workspace',
        designTarget: 'app',
        artifacts: [
          htmlArtifact('home', 'Home', {
            prototypeLinks: [
              {
                targetTitle: 'Settings',
                targetArtifactId: 'settings',
                href: '../settings/v1.html',
                label: 'Open settings'
              }
            ]
          }),
          htmlArtifact('settings', 'Settings')
        ],
        initialArtifactId: 'home',
        onClose: () => {}
      })
    )

    expect(html).toContain('aspect-ratio:390 / 844')
    expect(html).toContain('height:100%')
    expect(html).toContain('.kun-design/doc/home/v1.html - 390 x 844')
    expect(html).toContain('All screens')
    expect(html).toContain('Home')
    expect(html).toContain('Settings')
    expect(html).toContain('.kun-design/doc/home/v1.html')
    expect(html).toContain('.kun-design/doc/settings/v1.html')
  })

  it('renders a web-target prototype shell with desktop viewport fallback', () => {
    const html = renderToStaticMarkup(
      createElement(PrototypePlayerOverlay, {
        open: true,
        workspaceRoot: '/workspace',
        designTarget: 'web',
        artifacts: [htmlArtifact('home', 'Home')],
        initialArtifactId: 'home',
        onClose: () => {}
      })
    )

    expect(html).toContain('aspect-ratio:1280 / 800')
    expect(html).toContain('width:100%')
    expect(html).toContain('.kun-design/doc/home/v1.html - 1280 x 800')
  })

  it('does not render when closed', () => {
    const html = renderToStaticMarkup(
      createElement(PrototypePlayerOverlay, {
        open: false,
        workspaceRoot: '/workspace',
        designTarget: 'app',
        artifacts: [htmlArtifact('home', 'Home')],
        onClose: () => {}
      })
    )

    expect(html).toBe('')
  })
})
