import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import type { SystemDeps, SearchResult } from '@/types'

interface AppState {
  currentPage: 'drop' | 'packages' | 'update' | 'apps' | 'maintenance' | 'config' | 'settings'
  setPage: (p: AppState['currentPage']) => void

  deps: SystemDeps | null
  depsLoading: boolean
  checkDeps: () => Promise<void>

  logs: string[]
  clearLogs: () => void
  appendLog: (line: string) => void

  searchResults: SearchResult[]
  setSearchResults: (r: SearchResult[]) => void

  ingestRunning: boolean
  ingestDone: boolean
  ingestSuccess: boolean
  desktopFile: string | null
  setIngestRunning: (r: boolean) => void
  setIngestDone: (d: boolean, success?: boolean) => void
  setDesktopFile: (d: string | null) => void

  progress: number
  progressLabel: string
  setProgress: (p: number) => void
  setProgressLabel: (l: string) => void

  errorBanner: string | null
  dismissError: () => void
  setErrorBanner: (e: string | null) => void

  pkgbuildReview: { packageName: string; content: string } | null
  setPkgbuildReview: (r: { packageName: string; content: string } | null) => void
}

export const useStore = create<AppState>((set) => ({
  currentPage: 'drop',
  setPage: (p) => set({ currentPage: p }),

  deps: null,
  depsLoading: false,
  checkDeps: async () => {
    set({ depsLoading: true })
    try {
      const deps = await invoke<SystemDeps>('check_system_deps')
      set({ deps, depsLoading: false })
    } catch {
      set({ depsLoading: false })
    }
  },

  logs: [],
  clearLogs: () => set({ logs: [] }),
  appendLog: (line) => set((s) => ({ logs: [...s.logs.slice(-500), line] })),

  searchResults: [],
  setSearchResults: (r) => set({ searchResults: r }),

  ingestRunning: false,
  ingestDone: false,
  ingestSuccess: false,
  desktopFile: null,
  setIngestRunning: (r) => set({ ingestRunning: r }),
  setIngestDone: (d, success = false) => set({ ingestDone: d, ingestSuccess: success }),
  setDesktopFile: (d) => set({ desktopFile: d }),

  progress: 0,
  progressLabel: '',
  setProgress: (p) => set({ progress: p }),
  setProgressLabel: (l) => set({ progressLabel: l }),

  errorBanner: null,
  dismissError: () => set({ errorBanner: null }),
  setErrorBanner: (e) => set({ errorBanner: e }),

  pkgbuildReview: null,
  setPkgbuildReview: (r) => set({ pkgbuildReview: r }),
}))
