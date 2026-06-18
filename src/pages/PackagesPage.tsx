import { useState, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useStore } from '@/store'
import { Card, ActionButton, ProgressBar, ErrorBanner, LogConsole, SectionTitle, Badge, Spinner } from '@/components/ui'
import { Package, Search, Info, Trash2, Download, ArrowRight, ArrowLeft, GitBranch, LayoutGrid, List } from 'lucide-react'
import clsx from 'clsx'
import type { SearchResult } from '@/types'
import { StoreGrid, AppPage } from '@/components/AurStore'

function parseSearch(raw: string): SearchResult[] {
  const results: SearchResult[] = []
  const lines = raw.split('\n')
  for (let i = 0; i < lines.length; i++) {
    // yay -Ss output: "aur/discord 0.0.27-1 (+287 12.34)"  (description on next line)
    // pacman -Ss:      "extra/discord 0.0.27-1"               (description on next line)
    // installed flag:  "extra/discord 0.0.27-1 [installed]"
    const m = lines[i].match(/^(\S+)\/(\S+)\s+(.+)$/)
    if (m) {
      const rest = m[3]
      // Check for [installed] suffix
      const installedMatch = rest.match(/^(.+?)(\s+\[installed[^\]]*\])$/)
      const withoutInstalled = installedMatch ? installedMatch[1] : rest
      const installed = !!installedMatch

      // Extract votes/popularity from "(+N N.NN)" suffix
      const meta = withoutInstalled.match(/\(\+(\d+)\s+([\d.]+)\)\s*$/)
      const version = meta
        ? withoutInstalled.slice(0, withoutInstalled.lastIndexOf('(')).trim()
        : withoutInstalled.trim()

      results.push({
        repo: m[1],
        name: m[2],
        version,
        description: lines[i + 1]?.trim() || '',
        installed,
        votes: meta ? parseInt(meta[1], 10) : undefined,
        popularity: meta ? parseFloat(meta[2]) : undefined,
      })
    }
  }
  return results
}

type TreeMode = 'forward' | 'reverse' | null

export function PackagesPage() {
  const store = useStore()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [aurMode, setAurMode] = useState(false)
  const [pkgInfo, setPkgInfo] = useState<string | null>(null)
  const [infoPkg, setInfoPkg] = useState('')
  const [searchLoading, setSearchLoading] = useState(false)
  const [opRunning, setOpRunning] = useState(false)
  const [treeMode, setTreeMode] = useState<TreeMode>(null)
  const [treePkg, setTreePkg] = useState('')
  const [treeContent, setTreeContent] = useState('')
  const [treeLoading, setTreeLoading] = useState(false)
  const [viewMode, setViewMode] = useState<'list' | 'store'>('list')
  const [storeApp, setStoreApp] = useState<SearchResult | null>(null)

  const doSearch = useCallback(async () => {
    if (!query.trim()) return
    setSearchLoading(true)
    try {
      const cmd = aurMode ? 'yay_search' : 'pacman_search'
      const [stdout] = await invoke<[string, string, number]>(cmd, { query })
      store.setSearchResults(parseSearch(stdout))
    } catch (e) {
      console.error('Search failed:', e)
      store.setErrorBanner(`Search failed: ${e}`)
    }
    setSearchLoading(false)
  }, [query, aurMode, store])

  const doInstalled = useCallback(async () => {
    setSearchLoading(true)
    try {
      const [stdout] = await invoke<[string, string, number]>('pacman_list_installed')
      store.setSearchResults(stdout.split('\n').filter(Boolean).map((l) => {
        const p = l.trim().split(/\s+/)
        return { repo: '', name: p[0] || '', version: p[1] || '', description: '' }
      }))
    } catch (e) {
      console.error('Failed to list installed packages:', e)
      store.setErrorBanner(`Failed to list installed packages: ${e}`)
    }
    setSearchLoading(false)
  }, [store])

  const toggle = (i: number) => setSelected((prev: Set<number>) => {
    const n = new Set(prev)
    if (n.has(i)) n.delete(i); else n.add(i)
    return n
  })
  const selectedPkgs = Array.from(selected).map((i) => store.searchResults[i]?.name).filter(Boolean)

  const runOp = useCallback(async (cmd: string, args: Record<string, unknown>) => {
    const cmdId = `${cmd}-${Date.now()}`
    store.clearLogs()
    store.setErrorBanner(null)
    setOpRunning(true)
    const unlisten = await listen(`stream-${cmdId}`, (ev) => {
      const p = ev.payload as { kind: string; line?: string; code?: number; message?: string }
      if (p.kind === 'stdout') store.appendLog(p.line!)
      else if (p.kind === 'stderr') store.appendLog(`⚠ ${p.line!}`)
      else if (p.kind === 'error') store.setErrorBanner(p.message!)
      else if (p.kind === 'exit') { store.setProgress(100); setOpRunning(false); unlisten() }
    })
    try { await invoke(cmd, { cmdId: cmdId, ...args }) } catch (e) { store.setErrorBanner(`${e}`); setOpRunning(false) }
  }, [store])

  const showTree = useCallback(async (mode: TreeMode, pkg: string) => {
    if (!pkg.trim()) return
    setTreeMode(mode)
    setTreePkg(pkg.trim())
    setTreeLoading(true)
    setTreeContent('')
    try {
      const cmd = mode === 'forward' ? 'pactree_forward' : 'pactree_reverse'
      const result = await invoke<string>(cmd, { package: pkg.trim() })
      setTreeContent(result || 'No dependencies found.')
    } catch (e) { setTreeContent(`Error: ${e}`) }
    setTreeLoading(false)
  }, [])

  return (
    <div className="h-full overflow-y-auto p-6 space-y-5">
      <SectionTitle icon={<Package size={20} className="text-accent-purple" />}>Package Browser</SectionTitle>
      {store.errorBanner && <ErrorBanner message={store.errorBanner} onDismiss={store.dismissError} />}

      <Card>
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input className="input pl-9" placeholder="Search packages..." value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && doSearch()} />
          </div>
          <ActionButton variant="primary" onClick={doSearch} disabled={searchLoading}>
            {searchLoading ? <Spinner size={15} /> : <Search size={15} />} Search
          </ActionButton>
          <ActionButton variant="ghost" onClick={doInstalled}>Installed</ActionButton>
          <div className="flex items-center gap-1 bg-dark-700 rounded-lg p-1">
            <button onClick={() => setAurMode(false)} className={clsx('px-3 py-1 rounded-md text-xs font-medium transition-colors', !aurMode ? 'bg-accent-blue/20 text-accent-blue' : 'text-text-muted hover:text-text-secondary')}>Official</button>
            <button onClick={() => setAurMode(true)} className={clsx('px-3 py-1 rounded-md text-xs font-medium transition-colors', aurMode ? 'bg-accent-purple/20 text-accent-purple' : 'text-text-muted hover:text-text-secondary')}>AUR</button>
          </div>
          <div className="flex items-center gap-1 bg-dark-700 rounded-lg p-1">
            <button onClick={() => setViewMode('list')} title="List view" className={clsx('p-1.5 rounded-md transition-colors', viewMode === 'list' ? 'bg-accent-blue/20 text-accent-blue' : 'text-text-muted hover:text-text-secondary')}><List size={15} /></button>
            <button onClick={() => setViewMode('store')} title="Store view" className={clsx('p-1.5 rounded-md transition-colors', viewMode === 'store' ? 'bg-accent-purple/20 text-accent-purple' : 'text-text-muted hover:text-text-secondary')}><LayoutGrid size={15} /></button>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-text-muted">{store.searchResults.length} results{selectedPkgs.length > 0 && <span className="text-accent-blue ml-2">({selectedPkgs.length} selected)</span>}</p>
          {selectedPkgs.length > 0 && (
            <div className="flex items-center gap-2">
              <ActionButton variant="success" onClick={() => runOp('pacman_install', { packages: selectedPkgs })}>
                <Download size={14} /> Install ({selectedPkgs.length})
              </ActionButton>
              <ActionButton variant="danger" onClick={() => { runOp('pacman_remove', { packages: selectedPkgs }); setSelected(new Set()); }}>
                <Trash2 size={14} /> Remove
              </ActionButton>
            </div>
          )}
        </div>
        {viewMode === 'store' ? (
          <StoreGrid results={store.searchResults} onOpen={setStoreApp} />
        ) : (
        <div className="overflow-auto max-h-80 rounded-xl border border-dark-500">
          <table className="w-full text-xs">
            <thead className="bg-dark-700 sticky top-0">
              <tr>
                <th className="px-3 py-2 w-8"></th>
                <th className="px-3 py-2 text-left text-text-muted font-medium">Package</th>
                <th className="px-3 py-2 text-left text-text-muted font-medium">Version</th>
                <th className="px-3 py-2 text-left text-text-muted font-medium">Repo</th>
                <th className="px-3 py-2 text-left text-text-muted font-medium">Description</th>
                <th className="px-3 py-2 w-20 text-center text-text-muted font-medium">Deps</th>
                <th className="px-3 py-2 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {store.searchResults.map((r, i) => (
                <tr key={i} onClick={() => toggle(i)} className={clsx('cursor-pointer border-t border-dark-500/50', selected.has(i) ? 'bg-accent-blue/10' : 'hover:bg-dark-500/50')}>
                  <td className="px-3 py-2"><div className={clsx('w-4 h-4 rounded border flex items-center justify-center', selected.has(i) ? 'bg-accent-blue border-accent-blue' : 'border-dark-300')}>{selected.has(i) && <span className="text-dark-900 text-[10px]">✓</span>}</div></td>
                  <td className="px-3 py-2 font-medium text-text-primary">{r.name}</td>
                  <td className="px-3 py-2 text-accent-green font-mono">{r.version}</td>
                  <td className="px-3 py-2"><Badge color={r.repo === 'aur' ? 'purple' : r.installed ? 'green' : 'blue'}>{r.repo || 'local'}</Badge></td>
                  <td className="px-3 py-2 text-text-muted max-w-xs truncate">{r.description}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => showTree('forward', r.name)} title="Show dependencies" className="p-1 rounded hover:bg-dark-400 text-text-muted hover:text-accent-cyan transition-colors"><ArrowRight size={12} /></button>
                      <button onClick={() => showTree('reverse', r.name)} title="Show reverse dependencies" className="p-1 rounded hover:bg-dark-400 text-text-muted hover:text-accent-purple transition-colors"><ArrowLeft size={12} /></button>
                    </div>
                  </td>
                  <td className="px-3 py-2"><button onClick={(e) => { e.stopPropagation(); setInfoPkg(r.name); invoke<[string, string, number]>('pacman_info', { name: r.name }).then(([o]) => setPkgInfo(o)).catch(() => {}) }} className="text-text-muted hover:text-accent-blue"><Info size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {store.searchResults.length === 0 && <p className="text-center text-text-muted text-sm py-8">Search for packages or click "Installed"</p>}
        </div>
        )}
      </Card>

      {pkgInfo && (
        <Card>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-accent-blue">{infoPkg}</p>
            <button onClick={() => setPkgInfo(null)} className="text-text-muted hover:text-text-primary text-lg">×</button>
          </div>
          <LogConsole lines={pkgInfo.split('\n')} maxHeight={200} />
        </Card>
      )}

      {treeMode && (
        <Card className="animate-slide-up">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <GitBranch size={16} className={treeMode === 'forward' ? 'text-accent-cyan' : 'text-accent-purple'} />
              <span className="text-sm font-semibold text-text-primary">
                {treeMode === 'forward' ? 'Dependencies of' : 'Required by'} <span className="text-accent-blue">{treePkg}</span>
              </span>
              <Badge color={treeMode === 'forward' ? 'blue' : 'purple'}>{treeMode === 'forward' ? 'forward' : 'reverse'}</Badge>
            </div>
            <button onClick={() => { setTreeMode(null); setTreeContent('') }} className="text-text-muted hover:text-text-primary text-lg">×</button>
          </div>
          {treeLoading ? (
            <div className="flex items-center gap-2 py-4 text-text-muted"><Spinner size={14} /><span className="text-sm">Loading tree...</span></div>
          ) : (
            <LogConsole lines={treeContent.split('\n')} maxHeight={260} />
          )}
        </Card>
      )}

      {store.logs.length > 0 && (
        <Card>
          <div className="flex items-center gap-2 mb-2">
            {opRunning && <Spinner size={14} className="text-accent-blue" />}
            <p className="text-xs font-semibold text-text-muted">{opRunning ? 'Operation in progress...' : 'Operation Log'}</p>
          </div>
          <ProgressBar value={store.progress} label={store.progressLabel} />
          <div className="mt-3"><LogConsole lines={store.logs} maxHeight={180} /></div>
        </Card>
      )}

      {storeApp && (
        <AppPage
          pkg={storeApp}
          installed={!!storeApp.installed}
          busy={opRunning}
          onClose={() => setStoreApp(null)}
          onInstall={() => runOp('pacman_install', { packages: [storeApp.name] })}
          onUninstall={() => runOp('pacman_remove', { packages: [storeApp.name] })}
          onTree={(mode, name) => { setStoreApp(null); showTree(mode, name) }}
        />
      )}
    </div>
  )
}
