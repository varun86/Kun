import { create } from 'zustand'
import type { ProjectDesignSystemV1 } from './project-design-system'

type ProjectDesignSystemState = {
  status: 'loading' | 'missing' | 'ready' | 'invalid'
  document: ProjectDesignSystemV1 | null
  errors: string[]
  sourceHash: string
  setLoading: () => void
  setMissing: () => void
  setReady: (document: ProjectDesignSystemV1, sourceHash: string) => void
  setInvalid: (errors: string[]) => void
  updateMeta: (patch: Partial<ProjectDesignSystemV1['meta']>) => void
}

export const useProjectDesignSystemStore = create<ProjectDesignSystemState>((set) => ({
  status: 'loading',
  document: null,
  errors: [],
  sourceHash: '',
  setLoading: () => set({ status: 'loading', errors: [] }),
  setMissing: () => set({ status: 'missing', document: null, errors: [], sourceHash: '' }),
  setReady: (document, sourceHash) => set({ status: 'ready', document, errors: [], sourceHash }),
  setInvalid: (errors) => set((state) => ({ ...state, status: 'invalid', errors })),
  updateMeta: (patch) => set((state) => state.document
    ? { document: { ...state.document, meta: { ...state.document.meta, ...patch } } }
    : state)
}))
