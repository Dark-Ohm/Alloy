import { useState, useMemo } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useStore } from '@/store'
import { Card, ActionButton, ErrorBanner, LogConsole, SectionTitle, Spinner } from '@/components/ui'
import { FileText, Eye, CheckCircle, Rocket, AlertTriangle, ExternalLink, Shield, ChevronDown, Info } from 'lucide-react'
import clsx from 'clsx'

// Strip ANSI escape codes from yay output
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '').replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '')
}

// Parsed PKGBUILD fields — only what a user needs to understand
type PkgInfo = {
  name: string
  version: string
  description: string
  url: string
  arch: string[]
  license: string
  depends: string[]
  makedepends: string[]
  sources: string[]
  hasChecksums: boolean
  hasGitCommit: boolean
  raw: string
}

function parsePkgbuild(raw: string): PkgInfo {
  const clean = stripAnsi(raw)
  const grab = (key: string): string => {
    const re = new RegExp(`^${key}=["']?([^"'\n]+)["']?`, 'm')
    return clean.match(re)?.[1]?.trim() ?? ''
  }
  const grabArray = (key: string): string[] => {
    // Handle both inline arrays: depends=('a' 'b') and multi-line
    const re = new RegExp(`${key}=\\(([^)]*)\\)`, 's')
    const m = clean.match(re)
    if (!m) return []
    return m[1].match(/'([^']+)'/g)?.map(s => s.replace(/'/g, '')) ?? []
  }

  const sources = grabArray('source')
  const hasChecksums = /\b(sha256sums|sha512sums|b2sums|md5sums)\s*=\s*\(/.test(clean)
  const hasGitCommit = sources.some(s => s.includes('commit='))

  return {
    name: grab('pkgname'),
    version: grab('pkgver'),
    description: grab('pkgdesc'),
    url: grab('url'),
    arch: grabArray('arch'),
    license: grab('license'),
    depends: grabArray('depends'),
    makedepends: grabArray('makedepends'),
    sources,
    hasChecksums,
    hasGitCommit,
    raw: clean,
  }
}

// Security assessment from parsed info
function securitySignals(info: PkgInfo): { label: string; ok: boolean }[] {
  const signals: { label: string; ok: boolean }[] = []
  signals.push({ label: info.hasChecksums ? 'Integrity checksums present' : 'No checksums found', ok: info.hasChecksums })
  signals.push({ label: info.hasGitCommit ? 'Pinned to specific commit' : 'Tracks latest source', ok: !info.hasGitCommit || true })
  const suspiciousHosts = info.sources.filter(s => {
    try { const u = new URL(s); return !['https://github.com', 'https://gitlab.com', 'https://sourceforge.net', 'https://releases.ubuntu.com', 'https://archive.ubuntu.com'].some(h => u.hostname.endsWith(new URL(h).hostname)) } catch { return false }
  })
  signals.push({ label: suspiciousHosts.length === 0 ? 'No unusual download sources' : `${suspiciousHosts.length} unusual source${suspiciousHosts.length !== 1 ? 's' : ''}`, ok: suspiciousHosts.length === 0 })
  return signals
}

export function ConfigPage() {
  const store = useStore()
  const [pkgInput, setPkgInput] = useState('')
  const [fetching, setFetching] = useState(false)
  const [showRaw, setShowRaw] = useState(false)
  const [approved, setApproved] = useState(false)

  const handleFetch = async () => {
    if (!pkgInput.trim()) return
    setFetching(true); setShowRaw(false); setApproved(false)
    try {
      const review = await invoke<{ packageName: string; content: string }>('yay_fetch_pkgbuild', { package: pkgInput.trim() })
      store.setPkgbuildReview(review)
    } catch (e) {
      store.setErrorBanner(`Failed to fetch PKGBUILD: ${e}`)
    }
    setFetching(false)
  }

  const info = useMemo(() => {
    if (!store.pkgbuildReview) return null
    return parsePkgbuild(store.pkgbuildReview.content)
  }, [store.pkgbuildReview])

  const signals = useMemo(() => info ? securitySignals(info) : [], [info])

  return (
    <div className="h-full overflow-y-auto p-6 space-y-5">
      <SectionTitle icon={<FileText size={20} className="text-accent-yellow" />}>PKGBUILD Review</SectionTitle>
      <p className="text-sm text-text-muted -mt-3">
        A PKGBUILD is the recipe Arch uses to build a package. Review it before installing from AUR.
      </p>
      {store.errorBanner && <ErrorBanner message={store.errorBanner} onDismiss={store.dismissError} />}

      <Card>
        <p className="text-xs text-text-muted mb-3">Enter an AUR package name to see what it does before installing.</p>
        <div className="flex items-center gap-3">
          <input className="input flex-1" placeholder="e.g., google-chrome, steam, visual-studio-code-bin" value={pkgInput} onChange={(e) => setPkgInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleFetch()} />
          <ActionButton variant="primary" onClick={handleFetch} disabled={fetching}>
            {fetching ? <Spinner size={15} /> : <Eye size={15} />} Look up
          </ActionButton>
        </div>
      </Card>

      {/* ── Parsed package info ── */}
      {info && (
        <div className="space-y-4 animate-slide-up">
          {/* Header card */}
          <Card>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <h3 className="text-lg font-bold text-text-primary">{info.name || store.pkgbuildReview!.packageName}</h3>
                {info.version && (
                  <p className="text-xs text-text-muted mt-0.5">Version {info.version}</p>
                )}
                {info.description && (
                  <p className="text-sm text-text-secondary mt-2 leading-relaxed">{info.description}</p>
                )}
                {info.url && (
                  <a href={info.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-accent-blue hover:underline mt-2">
                    <ExternalLink size={11} /> {info.url}
                  </a>
                )}
              </div>
              {!approved ? (
                <div className="flex items-center gap-2 shrink-0">
                  <ActionButton variant="ghost" onClick={() => store.setPkgbuildReview(null)}>Cancel</ActionButton>
                  <ActionButton variant="success" onClick={() => setApproved(true)}>
                    <CheckCircle size={15} /> Looks good
                  </ActionButton>
                </div>
              ) : (
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-accent-green font-medium flex items-center gap-1"><CheckCircle size={13} /> Approved</span>
                  <ActionButton variant="primary" onClick={() => {
                    store.clearLogs()
                    invoke('yay_install', { cmdId: `review-install-${Date.now()}`, packages: [store.pkgbuildReview!.packageName] })
                  }}>
                    <Rocket size={15} /> Install
                  </ActionButton>
                </div>
              )}
            </div>
          </Card>

          {/* Details grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* What it builds */}
            <Card>
              <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">What it installs</h4>
              <div className="space-y-2 text-sm">
                {info.name && (
                  <div className="flex justify-between">
                    <span className="text-text-muted">Package name</span>
                    <span className="text-text-primary font-mono text-xs">{info.name}</span>
                  </div>
                )}
                {info.arch.length > 0 && (
                  <div className="flex justify-between">
                    <span className="text-text-muted">Architecture</span>
                    <span className="text-text-primary font-mono text-xs">{info.arch.join(', ')}</span>
                  </div>
                )}
                {info.license && (
                  <div className="flex justify-between">
                    <span className="text-text-muted">License</span>
                    <span className="text-text-primary font-mono text-xs">{info.license}</span>
                  </div>
                )}
              </div>
            </Card>

            {/* Dependencies */}
            <Card>
              <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">Dependencies</h4>
              {info.depends.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {info.depends.map((d) => (
                    <span key={d} className="px-2 py-0.5 rounded-md text-[11px] font-mono bg-dark-700 text-text-secondary border border-white/[0.05]">{d}</span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-text-muted">No extra runtime dependencies.</p>
              )}
              {info.makedepends.length > 0 && (
                <div className="mt-3 pt-2 border-t border-dark-500">
                  <p className="text-[10px] text-text-dim mb-1.5">Build-time only:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {info.makedepends.map((d) => (
                      <span key={d} className="px-2 py-0.5 rounded-md text-[10px] font-mono bg-dark-800 text-text-dim border border-white/[0.03]">{d}</span>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          </div>

          {/* Security signals */}
          <Card>
            <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3 flex items-center gap-1.5">
              <Shield size={13} /> Security check
            </h4>
            <div className="space-y-2">
              {signals.map((s, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  {s.ok ? (
                    <CheckCircle size={14} className="text-accent-green shrink-0" />
                  ) : (
                    <AlertTriangle size={14} className="text-accent-yellow shrink-0" />
                  )}
                  <span className={s.ok ? 'text-text-secondary' : 'text-accent-yellow'}>{s.label}</span>
                </div>
              ))}
            </div>
          </Card>

          {/* Sources */}
          {info.sources.length > 0 && (
            <Card>
              <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">Download sources</h4>
              <div className="space-y-1.5 max-h-40 overflow-auto">
                {info.sources.map((s, i) => {
                  let display = s
                  let isExternal = false
                  try {
                    const u = new URL(s)
                    display = u.hostname + u.pathname.slice(0, 60) + (u.pathname.length > 60 ? '…' : '')
                    isExternal = !u.hostname.includes('archlinux.org')
                  } catch { /* local or git path */ }
                  return (
                    <div key={i} className="flex items-center gap-2 text-[11px] font-mono text-text-dim">
                      <span className="w-1.5 h-1.5 rounded-full bg-dark-500 shrink-0" />
                      <span className="truncate">{display}</span>
                      {isExternal && <ExternalLink size={10} className="text-accent-yellow shrink-0" />}
                    </div>
                  )
                })}
              </div>
            </Card>
          )}

          {/* Raw PKGBUILD (collapsed) */}
          <Card>
            <button
              onClick={() => setShowRaw(!showRaw)}
              className="w-full flex items-center gap-2 text-xs text-text-dim hover:text-text-secondary transition-colors"
            >
              <ChevronDown size={12} className={clsx('transition-transform', showRaw && 'rotate-180')} />
              {showRaw ? 'Hide' : 'Show'} raw PKGBUILD
            </button>
            {showRaw && (
              <div className="mt-3 rounded-xl overflow-hidden border border-dark-400 bg-dark-900" style={{ height: 400 }}>
                <div className="h-full overflow-auto p-4">
                  <pre className="text-[11px] leading-relaxed font-mono whitespace-pre text-text-secondary">
                    {info.raw}
                  </pre>
                </div>
              </div>
            )}
          </Card>

          {/* Footer explainer */}
          <div className="text-[10px] text-text-dim space-y-1 pt-1">
            <p className="flex items-start gap-1.5 leading-relaxed">
              <Info size={11} className="shrink-0 mt-0.5" />
              <span><b>Looks good</b> approves the build recipe. Then click <b>Install</b> to compile and install the package.</span>
            </p>
            <p className="flex items-start gap-1.5 leading-relaxed">
              <Info size={11} className="shrink-0 mt-5" />
              <span>AUR packages are built on your machine from source. Only install packages you trust.</span>
            </p>
          </div>
        </div>
      )}

      {store.logs.length > 0 && (
        <Card>
          <p className="text-xs font-semibold text-text-muted mb-2">Operation Log</p>
          <LogConsole lines={store.logs} maxHeight={200} />
        </Card>
      )}
    </div>
  )
}
