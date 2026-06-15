import { useState, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useStore } from '@/store'
import { Card, ActionButton, ErrorBanner, SuccessBanner, LogConsole, SectionTitle, Badge, Spinner } from '@/components/ui'
import { Wrench, Trash2, Key, HardDrive, FileX } from 'lucide-react'

export function MaintenancePage() {
  const store = useStore()
  const [keep, setKeep] = useState(3)
  const [pacnewFiles, setPacnewFiles] = useState<string[]>([])
  const [diskInfo, setDiskInfo] = useState('')
  const [orphansCleaned, setOrphansCleaned] = useState(false)
  const [orphansRunning, setOrphansRunning] = useState(false)

  const handleCleanOrphans = useCallback(async () => {
    setOrphansCleaned(false)
    setOrphansRunning(true)
    store.clearLogs()
    store.setErrorBanner(null)
    const cmdId = `orphans-${Date.now()}`
    const unlisten = await listen(`stream-${cmdId}`, (ev) => {
      const p = ev.payload as { kind: string; line?: string; code?: number; message?: string }
      if (p.kind === 'stdout') store.appendLog(p.line!)
      else if (p.kind === 'stderr') store.appendLog(`⚠ ${p.line!}`)
      else if (p.kind === 'error') store.setErrorBanner(p.message!)
      else if (p.kind === 'exit') setOrphansRunning(false)
    })
    try {
      await invoke('yay_clean_orphans', { cmdId: cmdId })
      setOrphansCleaned(true)
    } catch (e) { store.setErrorBanner(`${e}`); setOrphansRunning(false) }
    unlisten()
  }, [])

  const handleScanPacnew = useCallback(async () => {
    try { setPacnewFiles(await invoke<string[]>('scan_pacnew')) } catch { /* noop */ }
  }, [])

  const handleDiskUsage = useCallback(async () => {
    try { setDiskInfo(await invoke<string>('disk_usage')) } catch { /* noop */ }
  }, [])

  return (
    <div className="h-full overflow-y-auto p-6 space-y-5">
      <SectionTitle icon={<Wrench size={20} className="text-accent-orange" />}>System Maintenance</SectionTitle>
      {store.errorBanner && <ErrorBanner message={store.errorBanner} onDismiss={store.dismissError} />}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <h3 className="font-semibold text-text-primary mb-1">Package Cache</h3>
          <p className="text-xs text-text-muted mb-3">Clean old cached package versions</p>
          <div className="flex items-center gap-2 mb-3">
            <label className="text-xs text-text-muted">Keep:</label>
            <input type="number" min={0} max={10} value={keep} onChange={(e) => setKeep(parseInt(e.target.value) || 0)} className="input w-20 py-1 text-xs" />
            <ActionButton variant="warning" onClick={() => invoke('paccache_clean', { keep })}><Trash2 size={14} /> Clean Old</ActionButton>
          </div>
          <ActionButton variant="ghost" onClick={() => invoke('paccache_clean_uninstalled')} className="w-full"><FileX size={14} /> Remove Uninstalled Cache</ActionButton>
          <div className="mt-2">
            <ActionButton variant="ghost" onClick={handleDiskUsage} className="w-full text-xs"><HardDrive size={14} /> {diskInfo ? `Cache: ${diskInfo}` : 'Check Disk Usage'}</ActionButton>
          </div>
        </Card>

        <Card>
          <h3 className="font-semibold text-text-primary mb-1">Orphan Packages</h3>
          <p className="text-xs text-text-muted mb-3">Remove packages no longer required</p>
          <ActionButton variant="warning" onClick={handleCleanOrphans} disabled={orphansRunning} className="w-full">
            {orphansRunning ? <><Spinner size={14} /> Cleaning...</> : <><Trash2 size={14} /> yay -Yc (Clean Orphans)</>}
          </ActionButton>
          {orphansCleaned && <div className="mt-3 pt-3 border-t border-dark-400"><SuccessBanner message="Orphan cleanup completed." /></div>}
        </Card>

        <Card>
          <h3 className="font-semibold text-text-primary mb-1">GPG Keyring</h3>
          <p className="text-xs text-text-muted mb-3">Fix package signature verification</p>
          <div className="flex flex-col gap-2">
            <ActionButton variant="ghost" onClick={() => invoke('pacman_key_init')} className="w-full justify-start"><Key size={14} /> Initialize</ActionButton>
            <ActionButton variant="ghost" onClick={() => invoke('pacman_key_populate')} className="w-full justify-start"><Key size={14} /> Populate Arch Keys</ActionButton>
            <ActionButton variant="ghost" onClick={() => invoke('pacman_key_refresh')} className="w-full justify-start"><Key size={14} /> Refresh All Keys</ActionButton>
          </div>
        </Card>

        <Card>
          <h3 className="font-semibold text-text-primary mb-1">Config File Conflicts</h3>
          <p className="text-xs text-text-muted mb-3">Scan for .pacnew and .pacsave files</p>
          <ActionButton variant="ghost" onClick={handleScanPacnew} className="w-full"><FileX size={14} /> Scan System</ActionButton>
          {pacnewFiles.length > 0 && (
            <div className="mt-3 space-y-1">
              <Badge color="yellow">{pacnewFiles.length} files found</Badge>
              <div className="max-h-40 overflow-auto text-[11px] font-mono text-text-muted bg-dark-800 rounded-lg p-2">
                {pacnewFiles.map((f, i) => <div key={i} className="truncate">{f}</div>)}
              </div>
            </div>
          )}
        </Card>
      </div>

      {store.logs.length > 0 && (<Card><p className="text-xs font-semibold text-text-muted mb-2">Operation Log</p><LogConsole lines={store.logs} maxHeight={200} /></Card>)}
    </div>
  )
}
