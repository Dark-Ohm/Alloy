import { useCallback, useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { open } from '@tauri-apps/plugin-dialog'
import { useStore } from '@/store'
import {
  Card, ActionButton, ProgressBar, ErrorBanner, SuccessBanner,
  LogConsole, SectionTitle, Spinner, Badge
} from '@/components/ui'
import { Upload, Rocket, Download, Trash2, RefreshCw } from 'lucide-react'
import clsx from 'clsx'

const ACCEPTED_EXTENSIONS = ['deb', 'rpm', 'tar', 'gz', 'xz', 'bz2', 'tgz', 'zst', 'appimage']

export function DropZone() {
  const store = useStore()
  const [dragOver, setDragOver] = useState(false)
  const [analysis, setAnalysis] = useState<{
    name: string; version: string; format: string; path: string; sizeBytes: number; description: string
  } | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [foreignPkgs, setForeignPkgs] = useState<Array<{ name: string; version: string; kind: string }>>([])
  const [foreignLoading, setForeignLoading] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)

  const loadForeignPkgs = useCallback(async () => {
    setForeignLoading(true)
    try {
      const result = await invoke<Array<[string, string, string]>>('list_tracked_packages')
      setForeignPkgs(result.map(([name, version, kind]) => ({ name, version, kind })))
    } catch { /* noop */ }
    setForeignLoading(false)
  }, [store])

  useEffect(() => { loadForeignPkgs() }, [loadForeignPkgs])

  const handleRemove = useCallback(async (pkgName: string) => {
    setRemoving(pkgName)
    try {
      const cmdId = `remove-${Date.now()}`
      await invoke('remove_tracked_package', { cmdId, name: pkgName })
      await loadForeignPkgs()
    } catch (e) {
      store.setErrorBanner(`Failed to remove ${pkgName}: ${e}`)
    }
    setRemoving(null)
  }, [loadForeignPkgs, store])

  const handleFile = useCallback(async (filePath: string) => {
    try {
      const result = await invoke<{
        packageName: string; version: string; format: string; filePath: string; sizeBytes: number; description: string
      }>('analyze_package', { path: filePath })
      if (result) {
        setAnalysis({
          name: result.packageName,
          version: result.version,
          format: result.format,
          path: result.filePath,
          sizeBytes: result.sizeBytes,
          description: result.description,
        })
      }
    } catch (e) { store.setErrorBanner(`Analysis failed: ${e}`) }
  }, [store])

  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === 'over') {
        setDragOver(true)
      } else if (event.payload.type === 'drop') {
        setDragOver(false)
        const paths = event.payload.paths
        if (paths && paths.length > 0) {
          const filePath = paths[0]
          const ext = filePath.split('.').pop()?.toLowerCase()
          if (!ACCEPTED_EXTENSIONS.includes(ext || '')) {
            store.setErrorBanner(`Unsupported format: .${ext}`)
            return
          }
          handleFile(filePath)
        }
      } else {
        setDragOver(false)
      }
    })
    return () => { unlisten.then(fn => fn()) }
  }, [handleFile, store])

  const handleBrowse = useCallback(async () => {
    const filePath = await open({
      multiple: false,
      filters: [{
        name: 'Packages',
        extensions: ['deb', 'rpm', 'tar', 'gz', 'xz', 'bz2', 'tgz', 'zst', 'AppImage', 'appimage'],
      }],
    })
    if (filePath) {
      await handleFile(filePath as string)
    }
  }, [handleFile])

  const runInstallation = useCallback(async (path: string) => {
    const cmdId = `ingest-${Date.now()}`
    store.setIngestRunning(true); store.setIngestDone(false); store.clearLogs(); store.setDesktopFile(null); store.setErrorBanner(null)
    const unlisten = await listen(`stream-${cmdId}`, (ev) => {
      const p = ev.payload as { kind: string; line?: string; code?: number; message?: string }
      if (p.kind === 'stdout') store.appendLog(p.line!)
      else if (p.kind === 'stderr') store.appendLog(`⚠ ${p.line!}`)
      else if (p.kind === 'error') store.setErrorBanner(p.message!)
      else if (p.kind === 'exit') { store.setIngestDone(true, (p.code ?? 1) === 0); store.setIngestRunning(false) }
    })
    try { await invoke('execute_installation', { cmdId: cmdId, path }) } catch (e) { store.setErrorBanner(`${e}`); store.setIngestDone(true, false); store.setIngestRunning(false) }
    unlisten()
    loadForeignPkgs()
  }, [store, loadForeignPkgs])

  const handleInstall = useCallback(() => { if (analysis) { setConfirming(false); runInstallation(analysis.path) } }, [analysis, runInstallation])

  const formatIcon = analysis?.format === 'deb' ? '📦' : analysis?.format === 'rpm' ? '🔴' : '📁'

  return (
    <div className="h-full flex flex-col p-6 gap-4 overflow-hidden">
      <SectionTitle icon={<Download size={20} className="text-accent-cyan" />}>Drop Zone — Foreign Package Converter</SectionTitle>
      {store.errorBanner && <ErrorBanner message={store.errorBanner} onDismiss={store.dismissError} />}

      {!analysis && (
        <div className={clsx('dropzone h-44', dragOver && 'active')} onClick={handleBrowse}>
          <Upload size={40} className={clsx(dragOver ? 'text-accent-blue' : 'text-text-muted')} />
          <p className="text-sm font-medium text-text-secondary">Drop <span className="text-accent-blue">.deb</span>, <span className="text-accent-red">.rpm</span>, <span className="text-accent-purple">.tar</span>, or <span className="text-accent-yellow">.AppImage</span> here</p>
          <p className="text-xs text-text-muted">or click to browse</p>
        </div>
      )}

      {analysis && !store.ingestDone && (
        <Card className="animate-slide-up shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="text-3xl">{formatIcon}</span>
              <div>
                <h3 className="font-semibold text-text-primary">{analysis.name}</h3>
                <p className="text-xs text-text-muted mt-0.5">{analysis.description}</p>
                <div className="flex items-center gap-2 mt-2">
                  <Badge color={analysis.format === 'deb' ? 'blue' : analysis.format === 'rpm' ? 'red' : 'purple'}>{analysis.format.toUpperCase()}</Badge>
                  <span className="text-xs text-text-muted">v{analysis.version}</span>
                  <span className="text-xs text-text-muted">•</span>
                  <span className="text-xs text-text-muted">{(analysis.sizeBytes / 1024 / 1024).toFixed(1)} MiB</span>
                </div>
              </div>
            </div>
            {!confirming && !store.ingestRunning && (
              <ActionButton variant="success" onClick={() => setConfirming(true)}><Rocket size={15} /> Install</ActionButton>
            )}
          </div>
          {confirming && !store.ingestRunning && (
            <div className="mt-4 pt-4 border-t border-dark-400 flex items-center gap-3">
              <p className="text-sm text-text-secondary flex-1">Convert and install via pacman?</p>
              <ActionButton variant="ghost" onClick={() => { setConfirming(false); setAnalysis(null) }}>Cancel</ActionButton>
              <ActionButton variant="success" onClick={handleInstall}>Confirm & Install</ActionButton>
            </div>
          )}
          {store.ingestRunning && (
            <div className="mt-4 pt-4 border-t border-dark-400 space-y-3">
              <div className="flex items-center gap-2 text-accent-cyan"><Spinner /><span className="text-sm font-medium">Converting & Installing...</span></div>
              <ProgressBar value={store.progress} label={store.progressLabel} color="blue" />
            </div>
          )}
        </Card>
      )}

      {store.ingestDone && (
        <div className="space-y-3 animate-fade-in shrink-0">
          {store.ingestSuccess ? <SuccessBanner message={`${analysis?.name} installed successfully!`} /> : <ErrorBanner message={`Installation of ${analysis?.name} failed.`} onDismiss={store.dismissError} />}
          {store.ingestSuccess && analysis && (
            <div className="flex gap-2">
              {store.desktopFile && (
                <ActionButton variant="success" onClick={() => { invoke('fish_shot', { script: `dex ${store.desktopFile} 2>/dev/null || gtk-launch "$(basename ${store.desktopFile!.replace('.desktop','')})" 2>/dev/null` }) }}>Launch</ActionButton>
              )}
              <ActionButton variant="danger" onClick={() => handleRemove(analysis.name)} disabled={removing !== null}>
                {removing === analysis.name ? <Spinner size={14} /> : <Trash2 size={14} />} Remove
              </ActionButton>
            </div>
          )}
          <ActionButton variant="ghost" onClick={() => { setAnalysis(null); store.setIngestDone(false); store.setDesktopFile(null) }}>Convert Another Package</ActionButton>
        </div>
      )}

      <Card className="flex-1 flex flex-col min-h-0">
        <div className="flex items-center justify-between mb-2 shrink-0">
          <p className="text-xs font-semibold text-text-muted">Foreign Packages ({foreignPkgs.length})</p>
          <ActionButton variant="ghost" onClick={loadForeignPkgs} disabled={foreignLoading}>
            {foreignLoading ? <Spinner size={12} /> : <RefreshCw size={12} />}
          </ActionButton>
        </div>
        <div className="flex-1 overflow-auto min-h-0">
          {foreignPkgs.length === 0 ? (
            <p className="text-xs text-text-muted py-4 text-center">No foreign packages installed</p>
          ) : (
            <div className="space-y-1">
              {foreignPkgs.map((pkg) => (
                <div key={pkg.name} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-dark-500/50 transition-colors group">
                  <span className="text-xs font-medium text-text-primary flex-1 truncate">{pkg.name}</span>
                  <Badge color={pkg.kind === 'deb' ? 'blue' : pkg.kind === 'rpm' ? 'red' : pkg.kind === 'appimage' ? 'yellow' : 'purple'}>{pkg.kind}</Badge>
                  <span className="text-[10px] text-text-muted font-mono">{pkg.version}</span>
                  <button
                    onClick={() => handleRemove(pkg.name)}
                    disabled={removing !== null}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-accent-red/20 text-text-muted hover:text-accent-red transition-all"
                    title={`Remove ${pkg.name}`}
                  >
                    {removing === pkg.name ? <Spinner size={12} /> : <Trash2 size={12} />}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {(store.ingestRunning || store.logs.length > 0) && (
        <Card className="shrink-0"><p className="text-xs font-semibold text-text-muted mb-2">Installation Log</p><LogConsole lines={store.logs} maxHeight={150} /></Card>
      )}
    </div>
  )
}
