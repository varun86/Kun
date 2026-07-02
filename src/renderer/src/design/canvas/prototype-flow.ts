import type { CanvasShape } from './canvas-types'
import { isHtmlFrame, shapeBounds } from './canvas-types'
import type { DesignArtifact } from '../design-types'
import { buildPrototypeHref } from '../design-turn-prompt'

export type PrototypeFlowEdge = {
  id: string
  sourceArtifactId: string
  targetArtifactId: string
  sourceTitle: string
  targetTitle: string
  label?: string
  href?: string
  x1: number
  y1: number
  x2: number
  y2: number
}

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

function center(shape: CanvasShape): { x: number; y: number } {
  const bounds = shapeBounds(shape)
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
}

function sortByCanvasReadingOrder(
  a: DesignArtifact,
  b: DesignArtifact,
  framesByArtifactId: Map<string, CanvasShape>
): number {
  const aBounds = shapeBounds(framesByArtifactId.get(a.id)!)
  const bBounds = shapeBounds(framesByArtifactId.get(b.id)!)
  const rowDelta = aBounds.y - bBounds.y
  if (Math.abs(rowDelta) > 48) return rowDelta
  return aBounds.x - bBounds.x
}

export function computePrototypeFlowEdges(
  artifacts: readonly DesignArtifact[],
  objects: Record<string, CanvasShape>
): PrototypeFlowEdge[] {
  const framesByArtifactId = new Map<string, CanvasShape>()
  for (const shape of Object.values(objects)) {
    if (!shape || shape.visible === false || !isHtmlFrame(shape) || !shape.htmlArtifactId) continue
    framesByArtifactId.set(shape.htmlArtifactId, shape)
  }

  const artifactsById = new Map(artifacts.map((artifact) => [artifact.id, artifact]))
  const htmlArtifacts = artifacts.filter((artifact) => artifact.kind === 'html')
  const uniqueArtifactByTitle = (title: string): DesignArtifact | undefined => {
    const normalized = normalizeTitle(title)
    if (!normalized) return undefined
    const exactMatches = htmlArtifacts.filter((artifact) => normalizeTitle(artifact.title) === normalized)
    if (exactMatches.length === 1) return exactMatches[0]
    if (exactMatches.length > 1) return undefined
    const fuzzyMatches = htmlArtifacts.filter((artifact) => fuzzyTitleMatch(title, artifact.title))
    return fuzzyMatches.length === 1 ? fuzzyMatches[0] : undefined
  }
  const edges: PrototypeFlowEdge[] = []
  const seen = new Set<string>()
  const visibleHtmlArtifacts = artifacts
    .filter((artifact) => artifact.kind === 'html' && framesByArtifactId.has(artifact.id))
    .sort((a, b) => sortByCanvasReadingOrder(a, b, framesByArtifactId))
  const fallbackTargetByArtifactId = new Map<string, DesignArtifact>()
  if (visibleHtmlArtifacts.length > 1) {
    visibleHtmlArtifacts.forEach((artifact, index) => {
      fallbackTargetByArtifactId.set(artifact.id, visibleHtmlArtifacts[(index + 1) % visibleHtmlArtifacts.length])
    })
  }
  const visibleOutboundCountByArtifactId = new Map<string, number>()

  const addEdge = (
    artifact: DesignArtifact,
    targetArtifact: DesignArtifact,
    link: { label?: string; href?: string },
    kind: 'explicit' | 'fallback'
  ): void => {
    if (targetArtifact.kind !== 'html' || targetArtifact.id === artifact.id) return
    const sourceFrame = framesByArtifactId.get(artifact.id)
    const targetFrame = framesByArtifactId.get(targetArtifact.id)
    if (!sourceFrame || !targetFrame) return
    const key = `${artifact.id}->${targetArtifact.id}:${link.label ?? link.href ?? kind}`
    if (seen.has(key)) return
    seen.add(key)
    visibleOutboundCountByArtifactId.set(artifact.id, (visibleOutboundCountByArtifactId.get(artifact.id) ?? 0) + 1)
    const source = center(sourceFrame)
    const target = center(targetFrame)
    edges.push({
      id: key,
      sourceArtifactId: artifact.id,
      targetArtifactId: targetArtifact.id,
      sourceTitle: artifact.title,
      targetTitle: targetArtifact.title,
      ...(link.label ? { label: link.label } : {}),
      ...(link.href ? { href: link.href } : {}),
      x1: source.x,
      y1: source.y,
      x2: target.x,
      y2: target.y
    })
  }

  for (const artifact of artifacts) {
    if (artifact.kind !== 'html' || !framesByArtifactId.has(artifact.id)) continue

    for (const link of artifact.prototypeLinks ?? []) {
      const targetArtifact =
        (link.targetArtifactId ? artifactsById.get(link.targetArtifactId) : undefined) ??
        uniqueArtifactByTitle(link.targetTitle)
      if (!targetArtifact) continue
      addEdge(artifact, targetArtifact, link, 'explicit')
    }

    if (
      (artifact.prototypeLinks?.length ?? 0) === 0 &&
      (visibleOutboundCountByArtifactId.get(artifact.id) ?? 0) === 0
    ) {
      const fallbackTarget = fallbackTargetByArtifactId.get(artifact.id)
      if (fallbackTarget) {
        addEdge(
          artifact,
          fallbackTarget,
          {
            href: buildPrototypeHref(artifact.relativePath, fallbackTarget.relativePath)
          },
          'fallback'
        )
      }
    }
  }

  return edges
}
