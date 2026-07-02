import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  canvasDocumentKey,
  canvasDocPath,
  parseCanvasDocument,
  persistCanvasDocument,
  serializeCanvasDocument
} from './canvas-persistence'
import { createDefaultShape, createEmptyDocument, createHtmlFrameShape, isHtmlFrame } from './canvas-types'

describe('canvas-persistence round-trip', () => {
  it('builds a stable document key from workspace and canvas path', () => {
    expect(canvasDocumentKey('/workspace', 'code-thread-1', '.kun-canvas')).toBe(
      `/workspace\0${canvasDocPath('code-thread-1', '.kun-canvas')}`
    )
  })

  it('preserves htmlArtifactId and devicePreset across serialize → parse', () => {
    const doc = createEmptyDocument()
    const root = doc.objects[doc.rootId]
    const frame = createHtmlFrameShape('Enjoy It', 0, 0, 'artifact-123', 'desktop')
    doc.objects[frame.id] = { ...frame, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...root, children: [frame.id] }

    const reloaded = parseCanvasDocument(serializeCanvasDocument(doc))
    expect(reloaded).not.toBeNull()
    const loadedFrame = reloaded!.objects[frame.id]
    // The htmlArtifactId link is what makes HtmlFrameOverlay mount the webview.
    // Dropping it on reload turns the screen into a blank white frame.
    expect(loadedFrame.htmlArtifactId).toBe('artifact-123')
    expect(loadedFrame.devicePreset).toBe('desktop')
    expect(isHtmlFrame(loadedFrame)).toBe(true)
  })

  it('does not invent htmlArtifactId for plain frames', () => {
    const doc = createEmptyDocument()
    const reloaded = parseCanvasDocument(serializeCanvasDocument(doc))
    expect(reloaded).not.toBeNull()
    const root = reloaded!.objects[reloaded!.rootId]
    expect(root.htmlArtifactId).toBeUndefined()
    expect(isHtmlFrame(root)).toBe(false)
  })

  it('migrates v1 relative child coords to absolute (v2) and bumps version', () => {
    // v1 stored children relative to their parent; v2 is absolute. A child at
    // relative (10, 20) inside a frame at (200, 100) must become absolute (210, 120),
    // and a grandchild accumulates the whole ancestor chain.
    const raw = JSON.stringify({
      version: 1,
      rootId: '__root__',
      objects: {
        __root__: { id: '__root__', type: 'frame', name: 'Root', x: 0, y: 0, children: ['frame'] },
        frame: { id: 'frame', type: 'frame', name: 'F', x: 200, y: 100, children: ['child'] },
        child: { id: 'child', type: 'group', name: 'C', x: 10, y: 20, children: ['leaf'] },
        leaf: { id: 'leaf', type: 'rect', name: 'L', x: 5, y: 5, children: [] }
      }
    })
    const reloaded = parseCanvasDocument(raw)
    expect(reloaded).not.toBeNull()
    expect(reloaded!.version).toBe(2)
    expect(reloaded!.objects.frame.x).toBe(200)
    expect(reloaded!.objects.frame.y).toBe(100)
    expect(reloaded!.objects.child.x).toBe(210)
    expect(reloaded!.objects.child.y).toBe(120)
    // leaf = 5 + (200 + 10) , 5 + (100 + 20)
    expect(reloaded!.objects.leaf.x).toBe(215)
    expect(reloaded!.objects.leaf.y).toBe(125)
  })

  it('leaves an already-absolute v2 doc untouched on load', () => {
    const raw = JSON.stringify({
      version: 2,
      rootId: '__root__',
      objects: {
        __root__: { id: '__root__', type: 'frame', name: 'Root', x: 0, y: 0, children: ['frame'] },
        frame: { id: 'frame', type: 'frame', name: 'F', x: 200, y: 100, children: ['child'] },
        child: { id: 'child', type: 'rect', name: 'C', x: 210, y: 120, children: [] }
      }
    })
    const reloaded = parseCanvasDocument(raw)
    expect(reloaded).not.toBeNull()
    expect(reloaded!.objects.child.x).toBe(210)
    expect(reloaded!.objects.child.y).toBe(120)
  })

  it('preserves the aiImageHolder flag across serialize → parse', () => {
    const doc = createEmptyDocument()
    const root = doc.objects[doc.rootId]
    const holder = createDefaultShape('image', 0, 0)
    holder.aiImageHolder = true
    const plain = createDefaultShape('image', 0, 0)
    doc.objects[holder.id] = { ...holder, parentId: doc.rootId }
    doc.objects[plain.id] = { ...plain, parentId: doc.rootId }
    doc.objects[doc.rootId] = { ...root, children: [holder.id, plain.id] }

    const reloaded = parseCanvasDocument(serializeCanvasDocument(doc))
    expect(reloaded).not.toBeNull()
    // parseShape is an allowlist — a dropped flag silently demotes the holder.
    expect(reloaded!.objects[holder.id].aiImageHolder).toBe(true)
    expect(reloaded!.objects[plain.id].aiImageHolder).toBeUndefined()
  })

  it('ignores a malformed devicePreset value', () => {
    const raw = JSON.stringify({
      version: 1,
      rootId: '__root__',
      objects: {
        __root__: { id: '__root__', type: 'frame', name: 'Root', children: ['f1'] },
        f1: { id: 'f1', type: 'frame', name: 'F', htmlArtifactId: 'a1', devicePreset: 'watch' }
      }
    })
    const reloaded = parseCanvasDocument(raw)
    expect(reloaded).not.toBeNull()
    const frame = reloaded!.objects.f1
    expect(frame.htmlArtifactId).toBe('a1')
    expect(frame.devicePreset).toBeUndefined()
  })
})

describe('persistCanvasDocument debounce', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('does not let one canvas save cancel another canvas save', () => {
    vi.useFakeTimers()
    const writeWorkspaceFile = vi.fn(async () => ({ ok: true as const }))
    vi.stubGlobal('window', { kunGui: { writeWorkspaceFile } })

    const designDoc = createEmptyDocument()
    const codeDoc = createEmptyDocument()

    persistCanvasDocument('/workspace', 'design-board', designDoc)
    persistCanvasDocument('/workspace', 'code-thread-1', codeDoc, '.kun-canvas')
    vi.advanceTimersByTime(600)

    expect(writeWorkspaceFile).toHaveBeenCalledTimes(2)
    expect(writeWorkspaceFile).toHaveBeenCalledWith({
      path: canvasDocPath('design-board'),
      workspaceRoot: '/workspace',
      content: serializeCanvasDocument(designDoc)
    })
    expect(writeWorkspaceFile).toHaveBeenCalledWith({
      path: canvasDocPath('code-thread-1', '.kun-canvas'),
      workspaceRoot: '/workspace',
      content: serializeCanvasDocument(codeDoc)
    })
  })

  it('keeps debouncing repeated saves for the same canvas', () => {
    vi.useFakeTimers()
    const writeWorkspaceFile = vi.fn(async () => ({ ok: true as const }))
    vi.stubGlobal('window', { kunGui: { writeWorkspaceFile } })

    const firstDoc = createEmptyDocument()
    const latestDoc = createEmptyDocument()
    const root = latestDoc.objects[latestDoc.rootId]
    const rect = createDefaultShape('rect', 10, 20)
    rect.name = 'Latest'
    latestDoc.objects[rect.id] = { ...rect, parentId: latestDoc.rootId }
    latestDoc.objects[latestDoc.rootId] = { ...root, children: [rect.id] }

    persistCanvasDocument('/workspace', 'code-thread-1', firstDoc, '.kun-canvas')
    persistCanvasDocument('/workspace', 'code-thread-1', latestDoc, '.kun-canvas')
    vi.advanceTimersByTime(600)

    expect(writeWorkspaceFile).toHaveBeenCalledTimes(1)
    expect(writeWorkspaceFile).toHaveBeenCalledWith({
      path: canvasDocPath('code-thread-1', '.kun-canvas'),
      workspaceRoot: '/workspace',
      content: serializeCanvasDocument(latestDoc)
    })
  })
})
