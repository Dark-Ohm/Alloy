import { useCallback, useState, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useStore } from '@/store'
import { Card, ActionButton, ErrorBanner, SectionTitle, Spinner } from '@/components/ui'
import { RefreshCw, Zap, Shield, AlertTriangle, BookOpen, CheckCircle, Download } from 'lucide-react'
import type { InformantResult, StreamEvent } from '@/types'

// ── Terminal color map ─────────────────────────────────────────────────
const TERM_COLORS: Record<string, string> = {
  '::': 'text-[#45475a]',
  'Packages': 'text-[#cdd6f4]',
  'Total': 'text-[#cdd6f4]',
  'Proceed': 'text-[#cdd6f4]',
  'core': 'text-[#89b4fa]',
  'extra': 'text-[#89b4fa]',
  'multilib': 'text-[#89b4fa]',
  'Synchronizing': 'text-[#cdd6f4]',
  'Starting': 'text-[#cdd6f4]',
  'Resolving': 'text-[#89dceb]',
  'Checking': 'text-[#89dceb]',
  'Retrieving': 'text-[#cdd6f4]',
  'loading': 'text-[#cdd6f4]',
  'upgrading': 'text-[#cdd6f4]',
  'installing': 'text-[#cdd6f4]',
  'Y': 'text-[#a6e3a1]',
  'Y/n': 'text-[#a6e3a1]',
}

// pacman/yay render live progress as "<prefix>[####----] 75%" — turn the
// ASCII bar into █/░ blocks and colour the filled run, empty run, and percent.
const PROGRESS_BAR_RE = /^(.*?)\[([#-]+)\]\s*(\d+)%(.*)$/

function renderProgressBar(m: RegExpMatchArray): JSX.Element {
  const [, prefix, bar, pct, suffix] = m
  const filled = (bar.match(/#/g) ?? []).length
  return (
    <span>
      <span className="text-[#f9e2af]">{prefix}</span>
      <span className="text-[#a6e3a1]">{'█'.repeat(filled)}</span>
      <span className="text-[#45475a]">{'░'.repeat(bar.length - filled)}</span>
      <span className="text-[#89dceb]"> {pct}%</span>
      <span className="text-[#45475a]">{suffix}</span>
    </span>
  )
}

function colorizeTermLine(line: string): JSX.Element {
  const bar = line.match(PROGRESS_BAR_RE)
  if (bar) return renderProgressBar(bar)
  const lower = line.toLowerCase()
  if (lower.includes('error') || lower.includes('failed')) {
    return <span className="text-[#f7768e]">{line}</span>
  }
  if (lower.includes('warning')) {
    return <span className="text-[#f9e2af]">{line}</span>
  }
  if (lower.includes('100%') || lower.includes('done') || lower === 'done') {
    return <span className="text-[#a6e3a1]">{line}</span>
  }
  if (line.startsWith('(') && line.includes('/')) {
    return <span className="text-[#f9e2af]">{line}</span>
  }
  for (const [key, cls] of Object.entries(TERM_COLORS)) {
    if (line.startsWith(key)) return <span className={cls}>{line}</span>
  }
  return <span className="text-[#6c7086]">{line}</span>
}

// ── Terminal output panel (no window chrome) ───────────────────────────
function TerminalPanel({ lines, liveLine, running }: { lines: string[]; liveLine: string; running: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [lines, liveLine])

  return (
    <div className="flex flex-col min-h-0 overflow-hidden flex-1">
      <div
        ref={ref}
        className="flex-1 overflow-y-auto p-4 font-mono text-[11.5px] leading-[1.75] bg-[#0d0f14] min-h-0 rounded-2xl border border-[#2a2d3a]"
      >
        {lines.length === 0 && !liveLine ? (
          <span className="text-[#45475a] italic">Click "Upgrade System" or "Combined Upgrade" to start…</span>
        ) : (
          lines.map((line, i) => (
            <div key={i}>{colorizeTermLine(line)}</div>
          ))
        )}
        {liveLine && (
          <div>
            {colorizeTermLine(liveLine)}
            {running && <span className="inline-block w-1.5 h-3.5 bg-[#89b4fa] align-middle ml-0.5 animate-pulse" />}
          </div>
        )}
        {running && !liveLine && (
          <span className="inline-block w-1.5 h-3.5 bg-[#89b4fa] align-middle ml-0.5 animate-pulse" />
        )}
      </div>
    </div>
  )
}

// ── Progress bar section ─────────────────────────────────────────────
function ProgressPills({ barPct, running }: { barPct: number; running: boolean }) {
  return (
    <Card className="shrink-0">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-sm font-medium text-[#cdd6f4]">
          <Download size={15} className="text-[#a6e3a1]" />
          Upgrading packages…
          {running && <Spinner size={12} className="text-[#a6e3a1]" />}
        </div>
        <span className="text-xs text-[#89b4fa] font-mono font-medium">{barPct}%</span>
      </div>

      {/* Progress bar with shimmer */}
      <div className="h-2.5 bg-[#1e2130] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-300 ease-out"
          style={{
            width: `${barPct}%`,
            background: 'linear-gradient(90deg, #89b4fa, #cba6f7)',
            animation: running ? 'shimmer 2.8s ease-in-out infinite' : 'none',
          }}
        />
      </div>
      <style>{`@keyframes shimmer{0%,100%{opacity:.75}50%{opacity:1}}`}</style>
    </Card>
  )
}

// ── Main page ──────────────────────────────────────────────────────────
export function SystemUpdatePage() {
  const store = useStore()
  const [running, setRunning] = useState(false)
  const [informant, setInformant] = useState<InformantResult | null>(null)
  const [checkingInformant, setCheckingInformant] = useState(false)
  const [informantPassed, setInformantPassed] = useState(false)
  const unlistenRef = useRef<(() => void) | null>(null)
  const [terminalLines, setTerminalLines] = useState<string[]>([])
  const [barPct, setBarPct] = useState(0)
  const [liveLine, setLiveLine] = useState('')
  const [upgradePreview, setUpgradePreview] = useState<string | null>(null)
  const [downgrades, setDowngrades] = useState<string[]>([])
  const [kernelPackages, setKernelPackages] = useState<string[]>([])
  const [dkmsModules, setDkmsModules] = useState<string[]>([])
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [confirmAction, setConfirmAction] = useState<'pacman' | 'yay' | null>(null)

  const checkInformant = useCallback(async () => {
    setCheckingInformant(true)
    try {
      const result = await invoke<InformantResult>('check_informant')
      setInformant(result)
      setInformantPassed(!result.hasUnread)
    } catch {
      setInformant(null)
      setInformantPassed(true)
    }
    setCheckingInformant(false)
  }, [])

  useEffect(() => {
    checkInformant()
    return () => { unlistenRef.current?.() }
  }, [checkInformant])

  const handleMarkRead = useCallback(async () => {
    try {
      await invoke('informant_read_all')
      setInformantPassed(true)
      setInformant(prev => prev ? { ...prev, hasUnread: false, message: 'All news marked as read.' } : null)
    } catch (e) {
      console.error('Failed to mark news as read:', e)
      store.setErrorBanner(`Failed to mark news as read: ${e}`)
    }
  }, [store])

  const previewUpgrade = useCallback(async (type: 'pacman' | 'yay') => {
    try {
      const cmd = type === 'pacman' ? 'preview_upgrade' : 'preview_yay_upgrade'
      const preview = await invoke<string>(cmd)
      setUpgradePreview(preview)
      
      // Check for downgrades
      const downgradeList = await invoke<string[]>('check_for_downgrades')
      setDowngrades(downgradeList)
      
      // Check for kernel packages
      const kernelList = await invoke<string[]>('check_kernel_packages')
      setKernelPackages(kernelList)
      
      // Check for DKMS modules
      const dkmsList = await invoke<string[]>('check_dkms_modules')
      setDkmsModules(dkmsList)
      
      setConfirmAction(type)
      setShowConfirmDialog(true)
    } catch (e) {
      store.setErrorBanner(`Failed to preview upgrade: ${e}`)
    }
  }, [store])

  const runStreamOp = useCallback(async (id: string, cmd: string) => {
    unlistenRef.current?.()
    setRunning(true)
    setTerminalLines([])
    setBarPct(0)
    setLiveLine('')
    store.clearLogs()
    store.setErrorBanner(null)
    store.setProgress(0)

    const tag = `stream-${id}`

    const exitPromise = new Promise<boolean>((resolve, reject) => {
      listen(tag, (ev) => {
        const p = ev.payload as StreamEvent

        if (p.kind === 'progress' && p.pkgTotal) {
          const preamblePct = 40
          const pkgPct = p.pkgTotal! > 0 ? Math.round(((p.pkgNum! - 1 + (p.pct ?? 0) / 100) / p.pkgTotal!) * 60) : 0
          setBarPct(preamblePct + pkgPct)
        }

        if (p.kind === 'stdoutRedraw' && p.line) {
          setLiveLine(p.line)
        }
        if (p.kind === 'stdout' && p.line) {
          setLiveLine('')
          setTerminalLines(prev => [...prev.slice(-2000), p.line!])
        }
        if (p.kind === 'stderr' && p.line) {
          setTerminalLines(prev => [...prev.slice(-2000), `⚠ ${p.line!}`])
        }
        if (p.kind === 'error') {
          store.setErrorBanner(p.message!)
          reject(new Error(p.message))
        }
        if (p.kind === 'exit') {
          setLiveLine('')
          setBarPct(100)
          store.setProgress(100)
          resolve((p.code ?? 1) === 0)
        }
      }).then(unlisten => { unlistenRef.current = unlisten })
    })

    let success = false
    try {
      await invoke(cmd, { cmdId: id })
      success = await exitPromise
    } catch (e) {
      store.setErrorBanner(String(e))
      success = false
    }

    setRunning(false)
    setLiveLine('')
    setTerminalLines(prev => [...prev, success ? '✓ Operation completed successfully' : '⚠ Operation finished with errors'])
  }, [store])

  const handleConfirmUpgrade = useCallback(async () => {
    setShowConfirmDialog(false)
    
    // Run the actual upgrade (snapshot is handled inside the upgrade script)
    if (confirmAction === 'pacman') {
      await runStreamOp(`upg-${Date.now()}`, 'pacman_upgrade')
    } else {
      await runStreamOp(`yayu-${Date.now()}`, 'yay_upgrade_combined')
    }
  }, [confirmAction, runStreamOp])

  const handlePacmanUpgrade = useCallback(async () => {
    if (informant && informant.hasUnread && informant.informantAvailable) {
      store.setErrorBanner('Unread Arch Linux news detected. Read and mark them as read before upgrading.')
      return
    }
    await previewUpgrade('pacman')
  }, [previewUpgrade, informant, store])

  const handleYayCombined = useCallback(async () => {
    if (informant && informant.hasUnread && informant.informantAvailable) {
      store.setErrorBanner('Unread Arch Linux news detected. Read and mark them as read before upgrading.')
      return
    }
    await previewUpgrade('yay')
  }, [previewUpgrade, informant, store])

  const disabled = running || (!!informant?.hasUnread && !!informant?.informantAvailable && !informantPassed)

  return (
    <div className="h-full overflow-y-auto p-6 space-y-4 flex flex-col">
      <SectionTitle icon={<RefreshCw size={20} className="text-accent-blue" />}>System Update</SectionTitle>
      {store.errorBanner && <ErrorBanner message={store.errorBanner} onDismiss={store.dismissError} />}

      {/* Confirmation Dialog */}
      {showConfirmDialog && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 animate-fade-in">
          <Card className="max-w-lg w-full mx-4 p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-accent-yellow/15 flex items-center justify-center shrink-0">
                <AlertTriangle size={20} className="text-accent-yellow" />
              </div>
              <div>
                <h3 className="font-semibold text-text-primary">Confirm System Upgrade</h3>
                <p className="text-xs text-text-muted mt-1">
                  This will upgrade ALL packages on your system. This operation cannot be easily undone.
                </p>
              </div>
            </div>
            
            {downgrades.length > 0 && (
              <div className="bg-accent-red/10 border border-accent-red/30 rounded-xl p-3">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle size={14} className="text-accent-red" />
                  <span className="text-xs font-semibold text-accent-red">Downgrade Warning</span>
                </div>
                <p className="text-xs text-accent-red/80 mb-2">The following packages will be downgraded:</p>
                <div className="max-h-24 overflow-auto text-[11px] font-mono text-accent-red/90">
                  {downgrades.map((d, i) => (
                    <div key={i} className="py-0.5">{d}</div>
                  ))}
                </div>
              </div>
            )}
            
            {kernelPackages.length > 0 && (
              <div className="bg-accent-red/10 border-2 border-accent-red/50 rounded-xl p-3">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle size={16} className="text-accent-red" />
                  <span className="text-sm font-bold text-accent-red">⚠ KERNEL UPDATE DETECTED</span>
                </div>
                <p className="text-xs text-accent-red/90 mb-2">
                  This upgrade includes kernel packages. Updating the kernel can cause system instability if:
                </p>
                <ul className="text-xs text-accent-red/80 mb-2 list-disc list-inside space-y-1">
                  <li>NVIDIA drivers or other kernel modules are not rebuilt</li>
                  <li>Kernel headers don't match the new kernel version</li>
                  <li>Bootloader configuration is incorrect</li>
                </ul>
                <div className="max-h-24 overflow-auto text-[11px] font-mono text-accent-red/90 bg-accent-red/5 rounded-lg p-2">
                  {kernelPackages.map((p, i) => (
                    <div key={i} className="py-0.5 font-semibold">{p}</div>
                  ))}
                </div>
                {dkmsModules.length > 0 && (
                  <div className="mt-2 text-[11px] text-accent-yellow">
                    <span className="font-semibold">DKMS modules found:</span> These will need to be rebuilt after kernel update.
                  </div>
                )}
              </div>
            )}
            
            {upgradePreview && (
              <div className="bg-dark-800 rounded-xl p-3">
                <p className="text-xs font-semibold text-text-muted mb-2">Packages to be upgraded:</p>
                <div className="max-h-40 overflow-auto text-[11px] font-mono text-text-secondary">
                  {upgradePreview.split('\n').slice(0, 30).map((line, i) => (
                    <div key={i} className="py-0.5">{line}</div>
                  ))}
                  {upgradePreview.split('\n').length > 30 && (
                    <div className="text-text-muted">... and {upgradePreview.split('\n').length - 30} more</div>
                  )}
                </div>
              </div>
            )}
            
            <div className="flex items-center justify-between pt-2">
              <p className="text-xs text-text-muted">
                {confirmAction === 'pacman' ? 'pacman -Syu (official repos only)' : 'yay -Syu (AUR + official)'}
              </p>
              <div className="flex items-center gap-2">
                <ActionButton variant="ghost" onClick={() => { setShowConfirmDialog(false); setUpgradePreview(null); setDowngrades([]); setKernelPackages([]); setDkmsModules([]) }}>
                  Cancel
                </ActionButton>
                <ActionButton 
                  variant={downgrades.length > 0 || kernelPackages.length > 0 ? 'danger' : 'primary'} 
                  onClick={handleConfirmUpgrade}
                >
                  <><Zap size={14} /> {kernelPackages.length > 0 ? 'I Understand, Upgrade Kernel' : downgrades.length > 0 ? 'Confirm & Upgrade' : 'Start Upgrade'}</>
                </ActionButton>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Informant */}
      {checkingInformant && (
        <Card className="flex items-center gap-3 shrink-0">
          <Spinner size={16} className="text-accent-yellow" />
          <span className="text-sm text-text-secondary">Checking Arch Linux news for breaking updates...</span>
        </Card>
      )}

      {informant && informant.informantAvailable && informant.hasUnread && !informantPassed && (
        <div className="bg-accent-red/10 border border-accent-red/30 rounded-2xl p-5 space-y-4 animate-fade-in shrink-0">
          <div className="flex items-start gap-3">
            <AlertTriangle size={22} className="text-accent-red shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-accent-red">Breaking Update Warning</h3>
              <p className="text-xs text-accent-red/80 mt-1">{informant.message}</p>
            </div>
          </div>
          {informant.entries.length > 0 && (
            <div className="bg-dark-800 rounded-xl p-4 max-h-40 overflow-auto">
              {informant.entries.map((entry, i) => (
                <div key={i} className="flex items-start gap-2 py-1.5 border-b border-dark-500/50 last:border-0">
                  <BookOpen size={12} className="text-accent-yellow shrink-0 mt-1" />
                  <span className="text-xs text-text-secondary">{entry}</span>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <ActionButton variant="warning" onClick={handleMarkRead}><CheckCircle size={14} /> Mark All as Read</ActionButton>
            <ActionButton variant="ghost" onClick={checkInformant}><RefreshCw size={14} /> Re-check</ActionButton>
          </div>
        </div>
      )}

      {informant && informant.informantAvailable && !informant.hasUnread && (
        <div className="flex items-center gap-2 bg-accent-green/10 border border-accent-green/20 rounded-xl px-4 py-2.5 shrink-0">
          <CheckCircle size={14} className="text-accent-green" />
          <span className="text-xs text-accent-green font-medium">No unread Arch news — safe to upgrade</span>
        </div>
      )}

      {informant && !informant.informantAvailable && (
        <div className="flex items-center gap-2 bg-accent-yellow/10 border border-accent-yellow/20 rounded-xl px-4 py-2.5 shrink-0">
          <AlertTriangle size={14} className="text-accent-yellow" />
          <span className="text-xs text-accent-yellow font-medium">informant not installed — breaking-update protection disabled</span>
        </div>
      )}

      {/* Upgrade buttons */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 shrink-0">
        <Card>
          <div className="flex items-start gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-accent-blue/15 flex items-center justify-center">
              <Shield size={20} className="text-accent-blue" />
            </div>
            <div><h3 className="font-semibold text-text-primary">Full System Upgrade</h3><p className="text-xs text-text-muted mt-0.5">pacman -Syu (official repos only)</p></div>
          </div>
          <ActionButton variant="primary" onClick={handlePacmanUpgrade} disabled={disabled} className="w-full">
            {running ? <Spinner size={15} /> : <RefreshCw size={15} />} Upgrade System
          </ActionButton>
        </Card>
        <Card>
          <div className="flex items-start gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-accent-purple/15 flex items-center justify-center">
              <Zap size={20} className="text-accent-purple" />
            </div>
            <div><h3 className="font-semibold text-text-primary">Combined Upgrade (AUR + Official)</h3><p className="text-xs text-text-muted mt-0.5">yay -Syu --combined-upgrade</p></div>
          </div>
          <ActionButton variant="primary" onClick={handleYayCombined} disabled={disabled} className="w-full">
            {running ? <Spinner size={15} /> : <Zap size={15} />} Combined Upgrade
          </ActionButton>
        </Card>
      </div>

      {/* Progress section — always visible */}
      <ProgressPills barPct={barPct} running={running} />

      {/* Terminal — always visible */}
      <TerminalPanel lines={terminalLines} liveLine={liveLine} running={running} />
    </div>
  )
}
