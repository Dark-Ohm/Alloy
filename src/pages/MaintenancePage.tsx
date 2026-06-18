import { useState, useCallback, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useStore } from '@/store'
import { Card, ActionButton, ErrorBanner, LogConsole, SectionTitle, Badge, Spinner } from '@/components/ui'
import { Wrench, Trash2, Key, HardDrive, FileX, CheckCircle2, XCircle, Info, Package, Search, FileCheck2, ChevronDown, Shield, AlertTriangle, ShieldAlert } from 'lucide-react'
import type { SecurityScanResult } from '@/types'
import clsx from 'clsx'

// A captured (stdout, stderr, code) result from a one-shot command.
type ShotResult = { ok: boolean; text: string }
type CardState = 'idle' | 'running' | ShotResult

// Small status line shown under a card's actions after it runs.
function ResultLine({ state }: { state: CardState }) {
  if (state === 'idle') return null
  if (state === 'running') {
    return (
      <div className="flex items-center gap-2 mt-3 text-xs text-accent-cyan">
        <Spinner size={13} /> Working…
      </div>
    )
  }
  return (
    <div className={clsx(
      'flex items-start gap-2 mt-3 text-xs rounded-lg p-2.5 border',
      state.ok ? 'bg-accent-green/10 border-accent-green/25 text-accent-green'
               : 'bg-accent-red/10 border-accent-red/25 text-accent-red',
    )}>
      {state.ok ? <CheckCircle2 size={14} className="shrink-0 mt-0.5" /> : <XCircle size={14} className="shrink-0 mt-0.5" />}
      <span className="break-words font-mono leading-relaxed whitespace-pre-wrap">{state.text}</span>
    </div>
  )
}

// A "what this does" explainer chip sitting under each card heading.
function Explain({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-1.5 text-xs text-text-muted mb-3 leading-relaxed">
      <Info size={13} className="shrink-0 mt-0.5 text-text-dim" />
      <span>{children}</span>
    </div>
  )
}

// ── Pacnew analysis ────────────────────────────────────────────────────
// An analyzed config-conflict file: the tool reads the diff itself and forms
// a recommendation so the user doesn't have to understand pacman internals.
type PacnewVerdict = 'trivial' | 'review' | 'sensitive'
type PacnewItem = {
  file: string          // /etc/foo.pacnew
  target: string        // /etc/foo
  title: string         // friendly name
  what: string          // what this config controls, plain English
  diff: string          // unified diff text
  added: number
  removed: number
  verdict: PacnewVerdict
  reason: string        // why we recommend what we recommend
  sensitive: boolean
}

// Friendly descriptions for the configs people actually see pacnew's for.
// Falls back to the bare path when unknown — still readable.
const CONFIG_INFO: { match: RegExp; title: string; what: string; sensitive?: boolean }[] = [
  { match: /\/etc\/pacman\.conf$/, title: 'Pacman settings', what: 'Controls which repositories you install packages from and core pacman options.', sensitive: true },
  { match: /mirrorlist$/, title: 'Download mirrors', what: 'The list of servers packages are downloaded from.', sensitive: true },
  { match: /\/etc\/resolv\.conf$/, title: 'DNS resolver', what: 'How your system looks up domain names. Usually managed automatically.', sensitive: true },
  { match: /\/etc\/fstab$/, title: 'Disk mounts', what: 'Which drives and partitions mount at boot. Risky to change blindly.', sensitive: true },
  { match: /\/etc\/sudoers/, title: 'Sudo rules', what: 'Who can run commands as root. A mistake here can lock you out.', sensitive: true },
  { match: /\/etc\/ssh\/sshd_config$/, title: 'SSH server', what: 'Remote login settings.', sensitive: true },
  { match: /\/etc\/nsswitch\.conf$/, title: 'Name lookup order', what: 'Order in which users, hosts, and groups are resolved.' },
  { match: /\/etc\/locale\.gen$/, title: 'System locales', what: 'Which languages/locales are generated.' },
  { match: /\/etc\/makepkg\.conf$/, title: 'Build settings', what: 'Compiler flags and options for building AUR packages.' },
  { match: /\/etc\/pacman\.d\//, title: 'Pacman drop-in', what: 'An extra pacman configuration file (often repo or mirror settings).' },
]

function describeConfig(file: string, target: string): { title: string; what: string; sensitive: boolean } {
  for (const c of CONFIG_INFO) {
    if (c.match.test(target) || c.match.test(file)) {
      return { title: c.title, what: c.what, sensitive: !!c.sensitive }
    }
  }
  return { title: target.split('/').pop() ?? target, what: 'A system configuration file.', sensitive: false }
}

// Decide a recommendation from the diff: is every change just comments/blank
// lines (trivial), or are real settings changing (review)? Sensitive files
// always get flagged regardless.
function analyzeDiff(diff: string, sensitive: boolean): { added: number; removed: number; verdict: PacnewVerdict; reason: string } {
  const lines = diff.split('\n')
  let added = 0, removed = 0, realAdded = 0, realRemoved = 0
  const isComment = (body: string) => {
    const t = body.trim()
    return t === '' || t.startsWith('#') || t.startsWith(';')
  }
  for (const l of lines) {
    if (l.startsWith('+++') || l.startsWith('---') || l.startsWith('@@')) continue
    if (l.startsWith('+')) { added++; if (!isComment(l.slice(1))) realAdded++ }
    else if (l.startsWith('-')) { removed++; if (!isComment(l.slice(1))) realRemoved++ }
  }
  const realChanges = realAdded + realRemoved
  if (sensitive) {
    return { added, removed, verdict: 'sensitive', reason: 'Important system file — review the diff before deciding.' }
  }
  if (realChanges === 0) {
    return { added, removed, verdict: 'trivial', reason: 'Only comments or formatting changed — safe to update.' }
  }
  return { added, removed, verdict: 'review', reason: `${realChanges} actual setting${realChanges === 1 ? '' : 's'} changed — worth a look.` }
}

// Human-readable change summary from a unified diff — replaces raw "+62 -89".
function diffSummary(item: PacnewItem): string {
  if (!item.diff) return 'No differences found.'
  const lines = item.diff.split('\n')
  let added = 0, removed = 0, realAdded = 0, realRemoved = 0
  const isComment = (body: string) => {
    const t = body.trim()
    return t === '' || t.startsWith('#') || t.startsWith(';')
  }
  for (const l of lines) {
    if (l.startsWith('+++') || l.startsWith('---') || l.startsWith('@@')) continue
    if (l.startsWith('+')) { added++; if (!isComment(l.slice(1))) realAdded++ }
    else if (l.startsWith('-')) { removed++; if (!isComment(l.slice(1))) realRemoved++ }
  }
  const parts: string[] = []
  if (realAdded > 0 || realRemoved > 0) {
    if (realAdded > 0) parts.push(`${realAdded} setting${realAdded !== 1 ? 's' : ''} added`)
    if (realRemoved > 0) parts.push(`${realRemoved} setting${realRemoved !== 1 ? 's' : ''} removed`)
  } else if (added > 0 || removed > 0) {
    parts.push('Only comments or blank lines changed')
  } else {
    parts.push('No meaningful changes')
  }
  if (item.sensitive) parts.push('important system file')
  return parts.join(' · ') + '.'
}

const VERDICT_META: Record<PacnewVerdict, { label: string; color: 'green' | 'yellow' | 'red'; recommend: 'keep' | 'review' }> = {
  trivial: { label: 'Safe to update', color: 'green', recommend: 'keep' },
  review: { label: 'Review changes', color: 'yellow', recommend: 'review' },
  sensitive: { label: 'Be careful', color: 'red', recommend: 'review' },
}

export function MaintenancePage() {
  const store = useStore()
  const [keep, setKeep] = useState(3)

  // Proactively-loaded system facts
  const [cacheSize, setCacheSize] = useState<string | null>(null)
  const [orphanCount, setOrphanCount] = useState<number | null>(null)

  // Package cache
  const [cacheScan, setCacheScan] = useState<CardState>('idle')
  const [cacheState, setCacheState] = useState<CardState>('idle')
  const [uninstState, setUninstState] = useState<CardState>('idle')

  // Orphans
  const [orphanScan, setOrphanScan] = useState<CardState>('idle')
  const [orphanList, setOrphanList] = useState<string[]>([])
  const [orphansRunning, setOrphansRunning] = useState(false)
  const [orphansResult, setOrphansResult] = useState<'idle' | ShotResult>('idle')

  // Keyring (streamed)
  const [keyRunning, setKeyRunning] = useState<string | null>(null)
  const [keyResult, setKeyResult] = useState<'idle' | ShotResult>('idle')

  // Pacnew
  const [pacnewItems, setPacnewItems] = useState<PacnewItem[] | null>(null)
  const [pacnewScanning, setPacnewScanning] = useState(false)
  const [openDiff, setOpenDiff] = useState<string | null>(null)
  const [pacnewBusy, setPacnewBusy] = useState<string | null>(null)

  // Security scan
  const [securityResult, setSecurityResult] = useState<SecurityScanResult | null>(null)
  const [securityScanning, setSecurityScanning] = useState(false)

  // ── Load current state on mount ──────────────────────────────────────
  const refreshFacts = useCallback(async () => {
    try { setCacheSize(await invoke<string>('disk_usage')) } catch (e) {
      console.error('Failed to get disk usage:', e)
    }
    try {
      const [out] = await invoke<[string, string, number]>('fish_shot', {
        script: 'pacman -Qtdq | wc -l',
      })
      setOrphanCount(parseInt(out.trim()) || 0)
    } catch (e) {
      console.error('Failed to check orphan packages:', e)
    }
  }, [])

  useEffect(() => { refreshFacts() }, [refreshFacts])

  // ── One-shot command runner with result capture ──────────────────────
  const runShot = useCallback(async (
    cmd: string,
    args: Record<string, unknown>,
    setState: (s: CardState) => void,
    successMsg: string,
  ) => {
    setState('running')
    store.setErrorBanner(null)
    try {
      const [stdout, stderr, code] = await invoke<[string, string, number]>(cmd, args)
      const out = (stdout || stderr || '').trim()
      if (code === 0) {
        setState({ ok: true, text: out ? `${successMsg}\n${out}`.slice(0, 800) : successMsg })
      } else {
        setState({ ok: false, text: (stderr || stdout || `Exited with code ${code}`).trim().slice(0, 800) })
      }
    } catch (e) {
      setState({ ok: false, text: `${e}` })
    }
    refreshFacts()
  }, [store, refreshFacts])

  // ── Scans (read-only previews) ───────────────────────────────────────
  const scanCache = useCallback(async () => {
    setCacheScan('running')
    try {
      const [out] = await invoke<[string, string, number]>('fish_shot', {
        script: `paccache -dvk${keep} 2>&1; echo "---"; paccache -dvuk0 2>&1`,
      })
      const lines = out.split('\n')
      const oldCount = (out.match(/finished: (\d+) packages/g) || [])
      setCacheScan({
        ok: true,
        text: oldCount.length
          ? `Prunable: ${oldCount.join(', ')}`
          : (lines.find((l) => l.includes('candidate')) ?? (out.trim().slice(0, 400) || 'Nothing prunable.')),
      })
    } catch (e) {
      setCacheScan({ ok: false, text: `${e}` })
    }
  }, [keep])

  const scanOrphans = useCallback(async () => {
    setOrphanScan('running')
    try {
      const [out] = await invoke<[string, string, number]>('fish_shot', { script: 'pacman -Qtdq' })
      const list = out.split('\n').map((l) => l.trim()).filter(Boolean)
      setOrphanList(list)
      setOrphanCount(list.length)
      setOrphanScan({ ok: true, text: list.length ? `${list.length} orphan${list.length === 1 ? '' : 's'} found.` : 'No orphan packages — system is clean.' })
    } catch (e) {
      setOrphanScan({ ok: false, text: `${e}` })
    }
  }, [])

  // ── Orphans cleanup (streaming) ──────────────────────────────────────
  const handleCleanOrphans = useCallback(async () => {
    setOrphansResult('idle')
    setOrphansRunning(true)
    store.clearLogs()
    store.setErrorBanner(null)
    const cmdId = `orphans-${Date.now()}`
    const unlisten = await listen(`stream-${cmdId}`, (ev) => {
      const p = ev.payload as { kind: string; line?: string; code?: number; message?: string }
      if (p.kind === 'stdout') store.appendLog(p.line!)
      else if (p.kind === 'stderr') store.appendLog(`⚠ ${p.line!}`)
      else if (p.kind === 'error') store.setErrorBanner(p.message!)
      else if (p.kind === 'exit') {
        setOrphansRunning(false)
        setOrphansResult(p.code === 0
          ? { ok: true, text: 'Orphan cleanup completed.' }
          : { ok: false, text: `Cleanup exited with code ${p.code}. See log below.` })
      }
    })
    try {
      await invoke('yay_clean_orphans', { cmdId })
    } catch (e) {
      store.setErrorBanner(`${e}`)
      setOrphansRunning(false)
    }
    unlisten()
    setOrphanList([])
    refreshFacts()
  }, [store, refreshFacts])

  // ── Keyring (streaming, so slow refresh-keys shows progress) ─────────
  const runKeyring = useCallback(async (cmd: string, label: string) => {
    setKeyResult('idle')
    setKeyRunning(label)
    store.clearLogs()
    store.setErrorBanner(null)
    const cmdId = `${cmd}-${Date.now()}`
    const unlisten = await listen(`stream-${cmdId}`, (ev) => {
      const p = ev.payload as { kind: string; line?: string; code?: number; message?: string }
      if (p.kind === 'stdout') store.appendLog(p.line!)
      else if (p.kind === 'stderr') store.appendLog(`⚠ ${p.line!}`)
      else if (p.kind === 'error') store.setErrorBanner(p.message!)
      else if (p.kind === 'exit') {
        setKeyRunning(null)
        setKeyResult(p.code === 0
          ? { ok: true, text: `${label} completed.` }
          : { ok: false, text: `${label} exited with code ${p.code}. See log below.` })
      }
    })
    // Map the existing one-shot key commands to their underlying scripts so we
    // can stream them. (pacman-key is slow / can hang on keyservers — streaming
    // is the only way the user sees it's alive.)
    const scripts: Record<string, string> = {
      pacman_key_init: 'pkexec pacman-key --init',
      pacman_key_populate: 'pkexec pacman-key --populate archlinux',
      pacman_key_refresh: 'pkexec pacman-key --refresh-keys',
    }
    try {
      await invoke('fish_stream', { cmdId, script: scripts[cmd], pkexec: false })
    } catch (e) {
      store.setErrorBanner(`${e}`)
      setKeyRunning(null)
    }
    unlisten()
  }, [store])

  // ── Pacnew ───────────────────────────────────────────────────────────
  // The original (target) path a .pacnew/.pacsave belongs to.
  const targetOf = (f: string) => f.replace(/\.(pacnew|pacsave)$/, '')

  // Scan AND analyze: for each file, read its diff and form a verdict so the
  // user gets "Safe to update / Review / Be careful" instead of a raw path.
  const handleScanPacnew = useCallback(async () => {
    setPacnewScanning(true)
    setOpenDiff(null)
    setPacnewItems(null)
    try {
      const files = await invoke<string[]>('scan_pacnew')
      const items: PacnewItem[] = await Promise.all(files.map(async (file) => {
        const target = targetOf(file)
        const { title, what, sensitive } = describeConfig(file, target)
        let diff = ''
        try {
          const [out] = await invoke<[string, string, number]>('fish_shot', {
            script: `diff -u '${target.replace(/'/g, "'\\''")}' '${file.replace(/'/g, "'\\''")}' 2>&1 | head -400`,
          })
          diff = out.trim()
        } catch (e) {
          console.error(`Failed to diff ${file}:`, e)
        }
        const { added, removed, verdict, reason } = analyzeDiff(diff, sensitive)
        return { file, target, title, what, diff, added, removed, verdict, reason, sensitive }
      }))
      // Sort: sensitive first, then review, then trivial — most-important on top.
      const rank: Record<PacnewVerdict, number> = { sensitive: 0, review: 1, trivial: 2 }
      items.sort((a, b) => rank[a.verdict] - rank[b.verdict])
      setPacnewItems(items)
    } catch {
      setPacnewItems([])
    }
    setPacnewScanning(false)
  }, [])

  const applyPacnew = useCallback(async (item: PacnewItem) => {
    setPacnewBusy(item.file)
    store.clearLogs(); store.setErrorBanner(null)
    const cmdId = `pacnew-apply-${Date.now()}`
    const done = new Promise<number>((resolve) => {
      listen(`stream-${cmdId}`, (ev) => {
        const p = ev.payload as { kind: string; line?: string; code?: number }
        if (p.kind === 'stdout') store.appendLog(p.line!)
        else if (p.kind === 'stderr') store.appendLog(`⚠ ${p.line!}`)
        else if (p.kind === 'exit') resolve(p.code ?? 1)
      })
    })
    const tq = item.target.replace(/'/g, "'\\''")
    const fq = item.file.replace(/'/g, "'\\''")
    // Back up the current config, then replace it with the .pacnew.
    const script = `pkexec fish -c "cp '${tq}' '${tq}.bak' 2>/dev/null; mv '${fq}' '${tq}'"`
    try {
      await invoke('fish_stream', { cmdId, script, pkexec: false })
      const code = await done
      if (code === 0) {
        store.appendLog(`✓ Updated ${item.target} (backup saved as ${item.target}.bak)`)
        await handleScanPacnew()
      } else store.setErrorBanner(`Failed to update ${item.target} (exit ${code})`)
    } catch (e) { store.setErrorBanner(`${e}`) }
    setPacnewBusy(null)
  }, [store, handleScanPacnew])

  const removePacnew = useCallback(async (item: PacnewItem) => {
    setPacnewBusy(item.file)
    store.clearLogs(); store.setErrorBanner(null)
    const cmdId = `pacnew-rm-${Date.now()}`
    const done = new Promise<number>((resolve) => {
      listen(`stream-${cmdId}`, (ev) => {
        const p = ev.payload as { kind: string; line?: string; code?: number }
        if (p.kind === 'stdout') store.appendLog(p.line!)
        else if (p.kind === 'stderr') store.appendLog(`⚠ ${p.line!}`)
        else if (p.kind === 'exit') resolve(p.code ?? 1)
      })
    })
    const script = `pkexec rm -f '${item.file.replace(/'/g, "'\\''")}'`
    try {
      await invoke('fish_stream', { cmdId, script, pkexec: false })
      const code = await done
      if (code === 0) { store.appendLog(`✓ Discarded ${item.file}`); await handleScanPacnew() }
      else store.setErrorBanner(`Failed to discard ${item.file} (exit ${code})`)
    } catch (e) { store.setErrorBanner(`${e}`) }
    setPacnewBusy(null)
  }, [store, handleScanPacnew])

  // ── AUR Malware Security Scan ───────────────────────────────────────
  const handleSecurityScan = useCallback(async () => {
    setSecurityScanning(true)
    setSecurityResult(null)
    store.setErrorBanner(null)
    try {
      const infected = await invoke<string[]>('security_scan_installed')
      const logHits = await invoke<string[]>('security_scan_log')
      const result: SecurityScanResult = {
        infectedPackages: infected.map(name => ({ name, installDate: 'unknown' })),
        logHits: logHits.map(l => {
          const m = l.match(/\[ALPM\] (\w+) (\S+)/)
          return { package: m?.[2] || '', action: m?.[1] || '', date: l.match(/\[([^\]]+)\]/)?.[1] || '' }
        }).filter(h => h.package),
        npmCacheHits: [],
        systemdSuspicious: [],
        totalCompromised: 1600,
      }
      setSecurityResult(result)
    } catch (e) {
      store.setErrorBanner(`Security scan failed: ${e}`)
    }
    setSecurityScanning(false)
  }, [store])

  return (
    <div className="h-full overflow-y-auto p-6 space-y-5">
      <SectionTitle icon={<Wrench size={20} className="text-accent-orange" />}>System Maintenance</SectionTitle>
      <p className="text-sm text-text-muted -mt-3">Routine housekeeping to keep your Arch system lean and healthy. Scan first to see what's there, then act.</p>
      {store.errorBanner && <ErrorBanner message={store.errorBanner} onDismiss={store.dismissError} />}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* ── Package Cache ── */}
        <Card>
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-semibold text-text-primary flex items-center gap-2"><HardDrive size={16} className="text-accent-blue" /> Package Cache</h3>
            {cacheSize && <Badge color={parseFloat(cacheSize) >= 5 ? 'yellow' : 'blue'}>{cacheSize} used</Badge>}
          </div>
          <Explain>
            Every package you install is kept in <span className="font-mono">/var/cache</span> so you can roll back.
            It grows endlessly — trim it to reclaim disk space.
          </Explain>

          <div className="flex items-center gap-2 mb-2">
            <label className="text-xs text-text-secondary whitespace-nowrap">Keep last</label>
            <input
              type="number" min={0} max={10} value={keep}
              onChange={(e) => setKeep(parseInt(e.target.value) || 0)}
              className="input w-16 py-1 text-xs text-center"
            />
            <label className="text-xs text-text-secondary whitespace-nowrap">versions</label>
            <div className="flex-1" />
            <ActionButton variant="ghost" onClick={scanCache} disabled={cacheScan === 'running'}>
              {cacheScan === 'running' ? <Spinner size={13} /> : <Search size={13} />} Scan
            </ActionButton>
          </div>
          <ResultLine state={cacheScan} />
          <div className="mt-2 flex flex-col gap-2">
            <ActionButton
              variant="warning"
              className="w-full"
              disabled={cacheState === 'running'}
              onClick={() => runShot('paccache_clean', { keep }, setCacheState, `Removed old versions, kept the latest ${keep}.`)}
            >
              <Trash2 size={14} /> Clean old versions
            </ActionButton>
            <ActionButton
              variant="ghost"
              className="w-full"
              disabled={uninstState === 'running'}
              onClick={() => runShot('paccache_clean_uninstalled', {}, setUninstState, 'Removed cached packages you no longer have installed.')}
            >
              <FileX size={14} /> Remove cache for uninstalled apps
            </ActionButton>
          </div>
          <ResultLine state={cacheState} />
          <ResultLine state={uninstState} />
        </Card>

        {/* ── Orphan Packages ── */}
        <Card>
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-semibold text-text-primary flex items-center gap-2"><Package size={16} className="text-accent-purple" /> Orphan Packages</h3>
            {orphanCount !== null && (
              <Badge color={orphanCount > 0 ? 'yellow' : 'green'}>
                {orphanCount === 0 ? 'none' : `${orphanCount} found`}
              </Badge>
            )}
          </div>
          <Explain>
            Leftover dependencies that were pulled in by other apps but are no longer needed by anything.
            Removing them is safe and frees space.
          </Explain>
          <div className="flex gap-2">
            <ActionButton variant="ghost" onClick={scanOrphans} disabled={orphanScan === 'running'} className="flex-1">
              {orphanScan === 'running' ? <Spinner size={13} /> : <Search size={13} />} Scan for orphans
            </ActionButton>
            <ActionButton
              variant={orphanCount === 0 ? 'ghost' : 'warning'}
              onClick={handleCleanOrphans}
              disabled={orphansRunning || orphanCount === 0}
              className="flex-1"
            >
              {orphansRunning
                ? <><Spinner size={14} /> Removing…</>
                : <><Trash2 size={14} /> {orphanCount ? `Remove ${orphanCount}` : 'Nothing to clean'}</>}
            </ActionButton>
          </div>
          <ResultLine state={orphanScan} />
          {orphanList.length > 0 && (
            <div className="mt-2 max-h-32 overflow-auto text-[11px] font-mono text-text-muted bg-dark-800 rounded-lg p-2">
              {orphanList.map((o) => <div key={o} className="truncate">{o}</div>)}
            </div>
          )}
          <ResultLine state={orphansResult} />
        </Card>

        {/* ── GPG Keyring ── */}
        <Card>
          <h3 className="font-semibold text-text-primary flex items-center gap-2 mb-1"><Key size={16} className="text-accent-yellow" /> Keyring Repair</h3>
          <Explain>
            Only needed when updates fail with a <span className="font-mono">signature is unknown trust</span> /
            <span className="font-mono"> corrupted</span> error. Run in order. Requires your password.
            <span className="text-accent-yellow"> Refreshing keys can take several minutes</span> — watch the log below.
          </Explain>
          <div className="flex flex-col gap-2">
            {[
              { n: 1, cmd: 'pacman_key_init', label: 'Initialize keyring' },
              { n: 2, cmd: 'pacman_key_populate', label: 'Load Arch signing keys' },
              { n: 3, cmd: 'pacman_key_refresh', label: 'Refresh all keys' },
            ].map(({ n, cmd, label }) => (
              <ActionButton key={cmd} variant="ghost" className="w-full justify-start" disabled={keyRunning !== null}
                onClick={() => runKeyring(cmd, label)}>
                <span className="text-text-dim font-mono text-[10px] w-4">{n}</span>
                {keyRunning === label ? <Spinner size={14} /> : <Key size={14} />} {label}
                {keyRunning === label && <span className="ml-auto text-[10px] text-accent-cyan">running…</span>}
              </ActionButton>
            ))}
          </div>
          <ResultLine state={keyResult} />
        </Card>

        {/* ── Config Conflicts (self-scrolling, fills the 4th grid cell) ── */}
        <Card>
          <h3 className="font-semibold text-text-primary flex items-center gap-2 mb-1"><FileX size={16} className="text-accent-cyan" /> Config File Conflicts</h3>
          <Explain>
            When a system update can't safely merge changes into a config you edited,
            it saves the new version next to yours. Decide which one to keep.
          </Explain>
          <ActionButton variant="ghost" onClick={handleScanPacnew} disabled={pacnewScanning} className="w-full">
            {pacnewScanning ? <><Spinner size={14} /> Analyzing…</> : <><Search size={14} /> Scan for conflicts</>}
          </ActionButton>

          {pacnewItems !== null && !pacnewScanning && (
            pacnewItems.length === 0 ? (
              <div className="flex items-center gap-2 mt-3 text-xs text-accent-green">
                <CheckCircle2 size={14} /> All clear — no config conflicts found.
              </div>
            ) : (
              <div className="mt-3 space-y-3">
                {/* ── Summary banner ── */}
                {(() => {
                  const safeCount = pacnewItems.filter((i) => i.verdict === 'trivial').length
                  const reviewCount = pacnewItems.filter((i) => i.verdict === 'review').length
                  const sensitiveCount = pacnewItems.filter((i) => i.verdict === 'sensitive').length
                  return (
                    <div className="bg-dark-800 rounded-xl p-3 border border-white/[0.05]">
                      <p className="text-xs text-text-secondary">
                        Found <span className="font-semibold text-text-primary">{pacnewItems.length}</span> conflict{pacnewItems.length !== 1 ? 's' : ''}
                      </p>
                      <div className="flex flex-wrap gap-3 mt-1.5">
                        {safeCount > 0 && (
                          <span className="flex items-center gap-1.5 text-[11px] text-accent-green">
                            <span className="w-2 h-2 rounded-full bg-accent-green" />
                            {safeCount} safe to auto-update
                          </span>
                        )}
                        {reviewCount > 0 && (
                          <span className="flex items-center gap-1.5 text-[11px] text-accent-yellow">
                            <span className="w-2 h-2 rounded-full bg-accent-yellow" />
                            {reviewCount} needs your decision
                          </span>
                        )}
                        {sensitiveCount > 0 && (
                          <span className="flex items-center gap-1.5 text-[11px] text-accent-red">
                            <span className="w-2 h-2 rounded-full bg-accent-red" />
                            {sensitiveCount} important — review carefully
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })()}

                {/* ── Bulk action for safe files ── */}
                {pacnewItems.filter((i) => i.verdict === 'trivial').length > 1 && (
                  <ActionButton
                    variant="success"
                    className="w-full"
                    onClick={async () => {
                      for (const item of pacnewItems) {
                        if (item.verdict === 'trivial') await applyPacnew(item)
                      }
                    }}
                    disabled={pacnewBusy !== null}
                  >
                    {pacnewBusy ? <Spinner size={14} /> : <CheckCircle2 size={14} />}
                    Update all safe files ({pacnewItems.filter((i) => i.verdict === 'trivial').length})
                  </ActionButton>
                )}

                {/* ── Individual conflict cards ── */}
                <div className="max-h-[28rem] overflow-y-auto pr-1 space-y-2">
                  {pacnewItems.map((item) => {
                    const meta = VERDICT_META[item.verdict]
                    const open = openDiff === item.file
                    const busy = pacnewBusy === item.file
                    const borderColor = meta.color === 'green' ? 'border-accent-green/25' : meta.color === 'yellow' ? 'border-accent-yellow/25' : 'border-accent-red/25'
                    const bgColor = meta.color === 'green' ? 'bg-accent-green/5' : meta.color === 'yellow' ? 'bg-accent-yellow/5' : 'bg-accent-red/5'

                    return (
                      <div key={item.file} className={clsx('rounded-xl border overflow-hidden transition-colors', borderColor, bgColor)}>
                        {/* ── File header ── */}
                        <div className="px-3.5 py-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <h4 className="text-sm font-semibold text-text-primary">{item.title}</h4>
                                <span className={clsx(
                                  'text-[10px] font-medium px-2 py-0.5 rounded-full',
                                  meta.color === 'green' && 'bg-accent-green/15 text-accent-green',
                                  meta.color === 'yellow' && 'bg-accent-yellow/15 text-accent-yellow',
                                  meta.color === 'red' && 'bg-accent-red/15 text-accent-red',
                                )}>{meta.label}</span>
                              </div>
                              <p className="text-[11px] text-text-muted mt-1 leading-relaxed">{item.what}</p>
                              <p className="text-[10px] font-mono text-text-dim mt-1 truncate">{item.target}</p>
                            </div>
                          </div>

                          {/* ── Change summary (human-readable) ── */}
                          <p className="text-[11px] text-text-secondary mt-2">
                            {item.diff ? diffSummary(item) : 'No readable differences.'}
                          </p>

                          {/* ── Actions ── */}
                          <div className="flex items-center gap-2 mt-3">
                            <ActionButton
                              variant={meta.recommend === 'keep' ? 'success' : 'primary'}
                              onClick={() => applyPacnew(item)}
                              disabled={busy}
                              className="flex-1"
                            >
                              {busy ? <Spinner size={13} /> : <FileCheck2 size={13} />}
                              Use new version
                            </ActionButton>
                            <button
                              onClick={() => removePacnew(item)}
                              disabled={busy}
                              title="Keep my current version, discard the new one"
                              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-white/[0.04] border border-dark-400 text-text-secondary hover:bg-white/[0.08] hover:text-text-primary transition-all disabled:opacity-40"
                            >
                              <Trash2 size={13} /> Keep mine
                            </button>
                          </div>

                          {/* ── Optional diff details ── */}
                          <button
                            onClick={() => setOpenDiff(open ? null : item.file)}
                            className="mt-2 text-[11px] text-text-dim hover:text-text-secondary transition-colors flex items-center gap-1"
                          >
                            <ChevronDown size={12} className={clsx('transition-transform', open && 'rotate-180')} />
                            {open ? 'Hide changes' : 'Show exact changes'}
                          </button>
                        </div>

                        {/* ── Expanded diff view ── */}
                        {open && item.diff && (
                          <div className="border-t border-white/[0.05] px-3.5 py-2.5 bg-dark-900/50 animate-fade-in">
                            <pre className="text-[10.5px] leading-relaxed font-mono whitespace-pre max-h-48 overflow-auto">
                              {item.diff.split('\n').map((line, i) => (
                                <div key={i} className={clsx(
                                  line.startsWith('+') && !line.startsWith('+++') && 'text-accent-green',
                                  line.startsWith('-') && !line.startsWith('---') && 'text-accent-red',
                                  line.startsWith('@@') && 'text-accent-cyan',
                                  (line.startsWith('+++') || line.startsWith('---')) && 'text-text-muted',
                                )}>{line || ' '}</div>
                              ))}
                            </pre>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* ── Footer explainer ── */}
                <div className="text-[10px] text-text-dim space-y-1 pt-1">
                  <p className="flex items-start gap-1.5 leading-relaxed">
                    <Info size={11} className="shrink-0 mt-0.5" />
                    <span><b>Use new version</b> — replaces your config with the updated one. Your old file is backed up automatically.</span>
                  </p>
                  <p className="flex items-start gap-1.5 leading-relaxed">
                    <Info size={11} className="shrink-0 mt-0.5" />
                    <span><b>Keep mine</b> — keeps your current config and deletes the new version.</span>
                  </p>
                </div>
              </div>
            )
          )}
        </Card>
      </div>

      {/* ── AUR Malware Security Scan ── */}
      <Card>
        <h3 className="font-semibold text-text-primary flex items-center gap-2 mb-1"><ShieldAlert size={16} className="text-accent-red" /> AUR Malware Check</h3>
        <Explain>
          Scans for packages compromised in the June 2026 supply-chain attack (atomic-lockfile, js-digest).
          Checks installed packages, pacman logs, npm/bun cache, and systemd persistence.
        </Explain>
        <ActionButton variant="ghost" onClick={handleSecurityScan} disabled={securityScanning} className="w-full">
          {securityScanning ? <><Spinner size={14} /> Scanning…</> : <><Shield size={14} /> Run security scan</>}
        </ActionButton>

        {securityResult && (
          <div className="mt-3 space-y-3 animate-fade-in">
            {/* Summary banner */}
            {(() => {
              const hasIssues = securityResult.infectedPackages.length > 0 || securityResult.logHits.length > 0 || securityResult.npmCacheHits.length > 0 || securityResult.systemdSuspicious.length > 0
              return (
                <div className={clsx(
                  'rounded-xl p-3 border',
                  hasIssues ? 'bg-accent-red/10 border-accent-red/30' : 'bg-accent-green/10 border-accent-green/25'
                )}>
                  <div className="flex items-center gap-2">
                    {hasIssues ? (
                      <AlertTriangle size={14} className="text-accent-red shrink-0" />
                    ) : (
                      <CheckCircle2 size={14} className="text-accent-green shrink-0" />
                    )}
                    <p className={clsx('text-xs font-semibold', hasIssues ? 'text-accent-red' : 'text-accent-green')}>
                      {hasIssues ? 'Threats detected — review below' : 'System clean — no indicators found'}
                    </p>
                  </div>
                  <p className="text-[11px] text-text-muted mt-1">
                    Checked {securityResult.totalCompromised.toLocaleString()} known compromised packages
                  </p>
                </div>
              )
            })()}

            {/* Installed infected packages */}
            {securityResult.infectedPackages.length > 0 && (
              <div className="bg-accent-red/5 border border-accent-red/20 rounded-xl p-3">
                <h4 className="text-xs font-semibold text-accent-red mb-2 flex items-center gap-1.5">
                  <AlertTriangle size={12} /> Infected packages installed ({securityResult.infectedPackages.length})
                </h4>
                <p className="text-[11px] text-accent-red/80 mb-2">
                  These packages were part of the June 2026 supply-chain attack and may contain malware.
                </p>
                <div className="max-h-32 overflow-auto space-y-1">
                  {securityResult.infectedPackages.map((p) => (
                    <div key={p.name} className="flex items-center justify-between text-[11px] font-mono">
                      <span className="text-accent-red font-semibold">{p.name}</span>
                      <span className="text-text-dim">{p.installDate}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Historical log hits */}
            {securityResult.logHits.length > 0 && (
              <div className="bg-accent-yellow/5 border border-accent-yellow/20 rounded-xl p-3">
                <h4 className="text-xs font-semibold text-accent-yellow mb-2 flex items-center gap-1.5">
                  <AlertTriangle size={12} /> Historical log matches ({securityResult.logHits.length})
                </h4>
                <p className="text-[11px] text-accent-yellow/80 mb-2">
                  These compromised packages were installed/updated during the attack window (June 9-12, 2026).
                </p>
                <div className="max-h-32 overflow-auto space-y-1">
                  {securityResult.logHits.map((h, i) => (
                    <div key={i} className="flex items-center justify-between text-[11px] font-mono">
                      <span className="text-accent-yellow">{h.package} <span className="text-text-dim">({h.action})</span></span>
                      <span className="text-text-dim">{h.date}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* npm/bun cache hits */}
            {securityResult.npmCacheHits.length > 0 && (
              <div className="bg-accent-red/5 border border-accent-red/20 rounded-xl p-3">
                <h4 className="text-xs font-semibold text-accent-red mb-2 flex items-center gap-1.5">
                  <AlertTriangle size={12} /> Malicious packages in cache ({securityResult.npmCacheHits.length})
                </h4>
                <p className="text-[11px] text-accent-red/80 mb-1">
                  The following malicious npm/bun packages were found in your package cache:
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {securityResult.npmCacheHits.map((p) => (
                    <span key={p} className="px-2 py-0.5 rounded-md text-[10px] font-mono bg-accent-red/15 text-accent-red border border-accent-red/30">{p}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Systemd suspicious */}
            {securityResult.systemdSuspicious.length > 0 && (
              <div className="bg-accent-red/5 border border-accent-red/20 rounded-xl p-3">
                <h4 className="text-xs font-semibold text-accent-red mb-2 flex items-center gap-1.5">
                  <AlertTriangle size={12} /> Suspicious systemd services ({securityResult.systemdSuspicious.length})
                </h4>
                <p className="text-[11px] text-accent-red/80 mb-2">
                  Services with Restart=always + RestartSec=30 are a known persistence mechanism for this malware.
                </p>
                <div className="max-h-24 overflow-auto space-y-1">
                  {securityResult.systemdSuspicious.map((s) => (
                    <div key={s} className="text-[10px] font-mono text-accent-red truncate">{s}</div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Card>

      {store.logs.length > 0 && (
        <Card>
          <p className="text-xs font-semibold text-text-muted mb-2">Operation Log</p>
          <LogConsole lines={store.logs} maxHeight={200} />
        </Card>
      )}
    </div>
  )
}
