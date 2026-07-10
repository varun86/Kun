import { useEffect } from 'react'
import { useDesignSystemStore } from './design-system-store'
import { createEmptyDesignSystem } from './design-system-types'
import {
  PROJECT_DESIGN_SYSTEM_PATH,
  createProjectDesignSystem,
  parseProjectDesignSystem,
  projectDesignSystemFromSystem,
  projectDesignSystemHash,
  serializeProjectDesignSystem,
  type ProjectDesignSystemV1
} from './project-design-system'
import { useProjectDesignSystemStore } from './project-design-system-store'

const SAVE_DEBOUNCE_MS = 300
const MISSING_POLL_MS = 1_500

export async function createProjectDesignSystemFile(
  workspaceRoot: string,
  name = 'Project design system'
): Promise<boolean> {
  if (!workspaceRoot || typeof window.kunGui?.writeWorkspaceFile !== 'function') return false
  const document = createProjectDesignSystem(name)
  const result = await window.kunGui.writeWorkspaceFile({
    path: PROJECT_DESIGN_SYSTEM_PATH,
    workspaceRoot,
    content: serializeProjectDesignSystem(document)
  }).catch(() => null)
  return Boolean(result?.ok)
}

export function useProjectDesignSystemSync(workspaceRoot: string, enabled: boolean): void {
  useEffect(() => {
    if (!enabled || !workspaceRoot) return
    const api = window.kunGui
    if (!api?.readWorkspaceFile || !api.writeWorkspaceFile) return

    let cancelled = false
    let applyingExternal = false
    let saveTimer: ReturnType<typeof setTimeout> | null = null
    let pollTimer: ReturnType<typeof setTimeout> | null = null
    let watchId: string | null = null
    let offChanged: (() => void) | null = null

    const clearWatch = (): void => {
      offChanged?.()
      offChanged = null
      if (watchId && api.unwatchWorkspaceFile) void api.unwatchWorkspaceFile(watchId).catch(() => undefined)
      watchId = null
    }

    const schedulePoll = (load: () => Promise<void>): void => {
      if (cancelled || pollTimer) return
      pollTimer = setTimeout(() => {
        pollTimer = null
        void load()
      }, MISSING_POLL_MS)
    }

    const applyContent = (content: string): boolean => {
      const hash = projectDesignSystemHash(content)
      const state = useProjectDesignSystemStore.getState()
      if (state.sourceHash === hash && state.status === 'ready') return true
      const parsed = parseProjectDesignSystem(content)
      if (!parsed.ok) {
        state.setInvalid(parsed.errors)
        return false
      }
      applyingExternal = true
      useDesignSystemStore.getState().loadSystem({
        tokens: parsed.document.tokens,
        components: parsed.document.components
      })
      state.setReady(parsed.document, hash)
      applyingExternal = false
      return true
    }

    const startWatch = async (): Promise<void> => {
      if (cancelled || watchId || !api.watchWorkspaceFile || !api.onWorkspaceFileChanged) return
      offChanged = api.onWorkspaceFileChanged((payload) => {
        if (!watchId || payload.watchId !== watchId || cancelled) return
        if (!payload.ok) {
          clearWatch()
          useProjectDesignSystemStore.getState().setMissing()
          useDesignSystemStore.getState().resetSystem()
          schedulePoll(load)
          return
        }
        applyContent(payload.content)
      })
      const result = await api.watchWorkspaceFile({ path: PROJECT_DESIGN_SYSTEM_PATH, workspaceRoot }).catch(() => null)
      if (cancelled) {
        if (result?.ok && api.unwatchWorkspaceFile) void api.unwatchWorkspaceFile(result.watchId).catch(() => undefined)
        return
      }
      if (!result?.ok) {
        offChanged?.()
        offChanged = null
        schedulePoll(load)
        return
      }
      watchId = result.watchId
      applyContent(result.content)
    }

    const load = async (): Promise<void> => {
      if (cancelled) return
      const result = await api.readWorkspaceFile({ path: PROJECT_DESIGN_SYSTEM_PATH, workspaceRoot }).catch(() => null)
      if (cancelled) return
      if (!result?.ok) {
        useProjectDesignSystemStore.getState().setMissing()
        applyingExternal = true
        useDesignSystemStore.getState().loadSystem(createEmptyDesignSystem())
        applyingExternal = false
        clearWatch()
        schedulePoll(load)
        return
      }
      applyContent(result.content)
      await startWatch()
      // Keep a low-frequency lifecycle check even while fs.watch is active:
      // editors commonly save via atomic rename, which can detach a file watcher.
      schedulePoll(load)
    }

    const persist = (): void => {
      if (cancelled || applyingExternal) return
      const projectState = useProjectDesignSystemStore.getState()
      if (!projectState.document || projectState.status === 'loading' || projectState.status === 'missing') return
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => {
        saveTimer = null
        if (cancelled) return
        const current = useProjectDesignSystemStore.getState()
        if (!current.document) return
        const document: ProjectDesignSystemV1 = projectDesignSystemFromSystem(
          useDesignSystemStore.getState().system,
          current.document
        )
        const content = serializeProjectDesignSystem(document)
        const hash = projectDesignSystemHash(content)
        applyingExternal = true
        current.setReady(document, hash)
        applyingExternal = false
        void api.writeWorkspaceFile({ path: PROJECT_DESIGN_SYSTEM_PATH, workspaceRoot, content }).catch(() => undefined)
      }, SAVE_DEBOUNCE_MS)
    }

    useProjectDesignSystemStore.getState().setLoading()
    const unsubscribeSystem = useDesignSystemStore.subscribe((state, previous) => {
      if (state.system === previous.system || applyingExternal) return
      const projectState = useProjectDesignSystemStore.getState()
      if (projectState.status === 'missing') {
        const hasContent = Object.keys(state.system.tokens).length > 0 || Object.keys(state.system.components).length > 0
        if (!hasContent) return
        const document = projectDesignSystemFromSystem(state.system, createProjectDesignSystem())
        projectState.setReady(document, '')
      }
      persist()
    })
    const unsubscribeProject = useProjectDesignSystemStore.subscribe((state, previous) => {
      if (state.document !== previous.document && state.sourceHash === previous.sourceHash) persist()
    })
    void load()

    return () => {
      cancelled = true
      if (saveTimer) clearTimeout(saveTimer)
      if (pollTimer) clearTimeout(pollTimer)
      clearWatch()
      unsubscribeSystem()
      unsubscribeProject()
    }
  }, [enabled, workspaceRoot])
}
