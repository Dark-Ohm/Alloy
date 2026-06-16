import { useState, useCallback, useEffect, useMemo } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useStore } from '@/store'
import { Card, ActionButton, ErrorBanner, SectionTitle, Spinner, Badge } from '@/components/ui'
import { Rocket, RefreshCw, Search, Briefcase, Gamepad2, Wrench, Clapperboard, LayoutGrid, X, Trash2, Network, Package as PackageIcon } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { AppEntry } from '@/types'

// ── Category metadata ─────────────────────────────────────────────────
// Order here defines the order sections render in. Keys must match the
// `category` strings produced by the Rust backend (services.rs::categorize).
const CATEGORY_ORDER = ['Productivity', 'Gaming', 'Tools', 'Media', 'Other'] as const
type Category = (typeof CATEGORY_ORDER)[number]

const CATEGORY_META: Record<Category, { icon: LucideIcon; accent: string }> = {
  Productivity: { icon: Briefcase, accent: 'text-accent-blue' },
  Gaming: { icon: Gamepad2, accent: 'text-accent-green' },
  Tools: { icon: Wrench, accent: 'text-accent-yellow' },
  Media: { icon: Clapperboard, accent: 'text-accent-purple' },
  Other: { icon: LayoutGrid, accent: 'text-accent-cyan' },
}

// Deterministic accent for the fallback letter-avatar, keyed off the name.
const AVATAR_ACCENTS = [
  'bg-accent-blue/20 text-accent-blue',
  'bg-accent-green/20 text-accent-green',
  'bg-accent-purple/20 text-accent-purple',
  'bg-accent-yellow/20 text-accent-yellow',
  'bg-accent-cyan/20 text-accent-cyan',
  'bg-accent-orange/20 text-accent-orange',
]
function avatarAccent(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return AVATAR_ACCENTS[h % AVATAR_ACCENTS.length]
}

function AppTile({ app, onSelect }: {
  app: AppEntry
  onSelect: (app: AppEntry) => void
}) {
  const [broken, setBroken] = useState(false)
  const showImg = app.iconDataUri && !broken
  return (
    <button
      onClick={() => onSelect(app)}
      title={app.name}
      className="p-3 bg-dark-700 rounded-xl hover:bg-dark-500 hover:-translate-y-0.5 transition-all duration-150 flex flex-col items-center gap-2 text-center"
    >
      <div className="w-12 h-12 rounded-lg flex items-center justify-center overflow-hidden">
        {showImg ? (
          <img
            src={app.iconDataUri}
            alt=""
            className="w-12 h-12 object-contain"
            onError={() => setBroken(true)}
          />
        ) : (
          <div className={`w-12 h-12 rounded-lg flex items-center justify-center text-xl font-semibold ${avatarAccent(app.name)}`}>
            {app.name.charAt(0).toUpperCase()}
          </div>
        )}
      </div>
      <span className="text-xs font-medium text-text-primary truncate w-full">{app.name}</span>
    </button>
  )
}

const GRID = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3'

// Extract the executable basename from a desktop-entry Exec= line, stripping
// field codes (%U, %f…), env prefixes, flags, and any path — e.g.
// "env FOO=1 /usr/bin/code --new-window %F" → "code".
function execBinary(exec: string): string {
  const tokens = exec.split(/\s+/).filter(Boolean)
  for (const tok of tokens) {
    if (tok.includes('=') || tok === 'env') continue       // env assignments / `env`
    if (tok.startsWith('%') || tok.startsWith('-')) continue
    return tok.split('/').pop() ?? tok
  }
  return ''
}

// Pull a single `Field : value` line out of `pacman -Qi` output.
function qiField(text: string, field: string): string {
  const re = new RegExp(`^${field}\\s*:\\s*(.+)$`, 'm')
  return text.match(re)?.[1]?.trim() ?? ''
}

type AppDetail = {
  pkg: string | null
  version: string
  description: string
  installedSize: string
  deps: string[]
}

function AppModal({ app, onClose, onRemoved }: {
  app: AppEntry
  onClose: () => void
  onRemoved: () => void
}) {
  const store = useStore()
  const [broken, setBroken] = useState(false)
  const [loading, setLoading] = useState(true)
  const [detail, setDetail] = useState<AppDetail | null>(null)
  const [launching, setLaunching] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [showDeps, setShowDeps] = useState(false)

  const showImg = app.iconDataUri && !broken

  // Resolve owning pacman package from the Exec binary, then load -Qi info.
  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoading(true)
      const bin = execBinary(app.execPath)
      let pkg: string | null = null
      try {
        if (bin) {
          const path = bin.includes('/') ? bin : `(which ${bin} 2>/dev/null; or echo ${bin})`
          const [out] = await invoke<[string, string, number]>('fish_shot', {
            script: `pacman -Qoq ${path} 2>/dev/null | head -1`,
          })
          pkg = out.trim() || null
        }
      } catch { /* noop */ }

      let version = '', description = '', installedSize = ''
      const deps: string[] = []
      if (pkg) {
        try {
          // Force C locale: pacman localizes -Qi field labels (e.g. "Version" →
          // "Версия"), which would break the English-label parsing below.
          const [qi] = await invoke<[string, string, number]>('fish_shot', {
            script: `env LC_ALL=C pacman -Qi ${pkg}`,
          })
          version = qiField(qi, 'Version')
          description = qiField(qi, 'Description')
          installedSize = qiField(qi, 'Installed Size')
          const depLine = qiField(qi, 'Depends On')
          if (depLine && depLine !== 'None') {
            for (const d of depLine.split(/\s+/)) {
              const name = d.split(/[<>=]/)[0]
              if (name) deps.push(name)
            }
          }
        } catch { /* noop */ }
      }
      if (alive) { setDetail({ pkg, version, description, installedSize, deps }); setLoading(false) }
    })()
    return () => { alive = false }
  }, [app])

  const handleLaunch = useCallback(async () => {
    setLaunching(true)
    try {
      await invoke('launch_app', { desktop_path: app.desktopPath })
      onClose()
    } catch (e) {
      store.setErrorBanner(`Failed to launch ${app.name}: ${e}`)
    }
    setLaunching(false)
  }, [app, onClose, store])

  const handleRemove = useCallback(async () => {
    if (!detail?.pkg) return
    setRemoving(true)
    try {
      const cmdId = `app-remove-${Date.now()}`
      const done = new Promise<number>((resolve) => {
        listen(`stream-${cmdId}`, (ev) => {
          const p = ev.payload as { kind: string; code?: number }
          if (p.kind === 'exit') resolve(p.code ?? 1)
        })
      })
      await invoke('pacman_remove', { cmdId, packages: [detail.pkg] })
      const code = await done
      if (code === 0) { onRemoved(); onClose() }
      else { store.setErrorBanner(`Removing ${detail.pkg} failed (exit ${code})`); setRemoving(false) }
    } catch (e) {
      store.setErrorBanner(`Failed to remove ${app.name}: ${e}`)
      setRemoving(false)
    }
  }, [app, detail, onClose, onRemoved, store])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-dark-900/70 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg glass-card border border-white/[0.08] rounded-3xl p-6 animate-slide-up shadow-2xl shadow-black/40"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start gap-4">
          <div className="w-20 h-20 rounded-2xl bg-dark-700/60 flex items-center justify-center overflow-hidden shrink-0">
            {showImg ? (
              <img src={app.iconDataUri} alt="" className="w-16 h-16 object-contain" onError={() => setBroken(true)} />
            ) : (
              <div className={`w-full h-full flex items-center justify-center text-3xl font-bold ${avatarAccent(app.name)}`}>
                {app.name.charAt(0).toUpperCase()}
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0 pt-1">
            <h2 className="text-xl font-bold text-text-primary truncate">{app.name}</h2>
            <div className="flex flex-wrap items-center gap-2 mt-1.5">
              <Badge color="green">{app.category}</Badge>
              {loading ? (
                <span className="text-xs text-text-muted flex items-center gap-1"><Spinner size={11} /> resolving…</span>
              ) : detail?.pkg ? (
                <span className="inline-flex items-center gap-1 text-xs text-text-muted font-mono">
                  <PackageIcon size={11} /> {detail.pkg}{detail.version && ` ${detail.version}`}
                </span>
              ) : (
                <span className="text-xs text-text-muted">not a pacman package</span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 -mt-1 -mr-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-white/[0.06] transition-all">
            <X size={18} />
          </button>
        </div>

        {/* Description */}
        <div className="mt-4 min-h-[2.5rem]">
          {loading ? (
            <div className="space-y-2">
              <div className="h-3 rounded skeleton w-full" />
              <div className="h-3 rounded skeleton w-3/4" />
            </div>
          ) : detail?.description ? (
            <p className="text-sm text-text-secondary leading-relaxed">{detail.description}</p>
          ) : (
            <p className="text-sm text-text-muted italic">No description available.</p>
          )}
          {detail?.installedSize && (
            <p className="text-xs text-text-muted mt-2">Installed size: {detail.installedSize}</p>
          )}
        </div>

        {/* Dependencies */}
        {showDeps && detail && (
          <div className="mt-4 p-3 rounded-xl bg-dark-700/50 border border-white/[0.05] animate-fade-in">
            <p className="text-xs font-semibold text-text-muted mb-2">
              Dependencies {detail.deps.length > 0 && `(${detail.deps.length})`}
            </p>
            {detail.deps.length === 0 ? (
              <p className="text-xs text-text-muted">{detail.pkg ? 'No direct dependencies.' : 'Unknown — not a tracked package.'}</p>
            ) : (
              <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                {detail.deps.map((d) => (
                  <span key={d} className="px-2 py-0.5 rounded-md text-[11px] font-mono bg-dark-600 text-text-secondary border border-white/[0.05]">{d}</span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Confirm remove */}
        {confirmRemove && (
          <div className="mt-4 p-3 rounded-xl bg-accent-red/10 border border-accent-red/30 animate-fade-in">
            <p className="text-sm text-text-secondary">Remove <span className="font-semibold text-accent-red">{detail?.pkg}</span> via pacman? This needs root.</p>
            <div className="flex gap-2 mt-3">
              <ActionButton variant="ghost" onClick={() => setConfirmRemove(false)}>Cancel</ActionButton>
              <ActionButton variant="danger" onClick={handleRemove} disabled={removing}>
                {removing ? <Spinner size={14} /> : <Trash2 size={14} />} Confirm Remove
              </ActionButton>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="mt-5 flex items-center gap-2">
          <ActionButton variant="success" onClick={handleLaunch} disabled={launching || removing}>
            {launching ? <Spinner size={14} /> : <Rocket size={14} />} Launch
          </ActionButton>
          <ActionButton variant="ghost" onClick={() => setShowDeps((s) => !s)} disabled={loading}>
            <Network size={14} /> Dependencies
          </ActionButton>
          <div className="flex-1" />
          <ActionButton
            variant="danger"
            onClick={() => setConfirmRemove(true)}
            disabled={loading || !detail?.pkg || removing || confirmRemove}
            title={detail?.pkg ? `Remove ${detail.pkg}` : 'Not a pacman package'}
          >
            {removing ? <Spinner size={14} /> : <Trash2 size={14} />} Remove
          </ActionButton>
        </div>
      </div>
    </div>
  )
}

export function ApplicationsPage() {
  const store = useStore()
  const [apps, setApps] = useState<AppEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<AppEntry | null>(null)
  const [filter, setFilter] = useState<'All' | Category>('All')
  const [query, setQuery] = useState('')

  const loadApps = useCallback(async () => {
    setLoading(true)
    try {
      const result = await invoke<AppEntry[]>('list_apps')
      setApps(result)
    } catch (e) {
      store.setErrorBanner(`Failed to load apps: ${e}`)
    }
    setLoading(false)
  }, [store])

  useEffect(() => {
    loadApps()
  }, [loadApps])

  // Apps after the search filter, grouped by category in render order.
  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matched = q ? apps.filter((a) => a.name.toLowerCase().includes(q)) : apps
    const buckets = new Map<Category, AppEntry[]>()
    for (const cat of CATEGORY_ORDER) buckets.set(cat, [])
    for (const app of matched) {
      const cat = (CATEGORY_ORDER as readonly string[]).includes(app.category)
        ? (app.category as Category)
        : 'Other'
      buckets.get(cat)!.push(app)
    }
    return CATEGORY_ORDER
      .map((cat) => ({ cat, items: buckets.get(cat)! }))
      .filter((g) => g.items.length > 0)
  }, [apps, query])

  const total = useMemo(() => grouped.reduce((n, g) => n + g.items.length, 0), [grouped])
  const visible = filter === 'All' ? grouped : grouped.filter((g) => g.cat === filter)

  return (
    <div className="h-full overflow-y-auto p-6 space-y-5">
      <SectionTitle icon={<Rocket size={20} className="text-accent-green" />}>Applications</SectionTitle>
      {store.errorBanner && <ErrorBanner message={store.errorBanner} onDismiss={store.dismissError} />}

      <Card className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-text-secondary">Installed applications from desktop files</p>
          <ActionButton variant="ghost" onClick={loadApps} disabled={loading}>
            {loading ? <Spinner size={14} /> : <RefreshCw size={14} />} Refresh
          </ActionButton>
        </div>

        {!loading && apps.length > 0 && (
          <div className="flex flex-col gap-3">
            {/* Search */}
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search applications..."
                className="w-full pl-9 pr-3 py-2 bg-dark-700 border border-dark-400 rounded-xl text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue/60 transition-colors"
              />
            </div>

            {/* Category filter pills */}
            <div className="flex flex-wrap gap-2">
              <FilterPill
                label="All"
                icon={LayoutGrid}
                accent="text-text-secondary"
                count={total}
                active={filter === 'All'}
                onClick={() => setFilter('All')}
              />
              {grouped.map(({ cat, items }) => {
                const { icon, accent } = CATEGORY_META[cat]
                return (
                  <FilterPill
                    key={cat}
                    label={cat}
                    icon={icon}
                    accent={accent}
                    count={items.length}
                    active={filter === cat}
                    onClick={() => setFilter(cat)}
                  />
                )
              })}
            </div>
          </div>
        )}
      </Card>

      <Card>
        {loading ? (
          <div className="flex items-center justify-center py-8 gap-2">
            <Spinner size={16} className="text-accent-blue" />
            <span className="text-sm text-text-muted">Scanning applications...</span>
          </div>
        ) : apps.length === 0 ? (
          <p className="text-center text-text-muted text-sm py-8">No applications found. Desktop files are scanned from ~/.local/share/applications and /usr/share/applications</p>
        ) : visible.length === 0 ? (
          <p className="text-center text-text-muted text-sm py-8">No applications match "{query}".</p>
        ) : (
          <div key={`${filter}-${query}`} className="space-y-7 animate-fade-in">
            {visible.map(({ cat, items }) => {
              const { icon: Icon, accent } = CATEGORY_META[cat]
              return (
                <section key={cat}>
                  <div className="flex items-center gap-2 mb-3">
                    <Icon size={17} className={accent} />
                    <h3 className="text-sm font-semibold text-text-primary">{cat}</h3>
                    <span className="text-xs text-text-muted">{items.length}</span>
                  </div>
                  <div className={GRID}>
                    {items.map((app) => (
                      <AppTile
                        key={app.desktopPath}
                        app={app}
                        onSelect={setSelected}
                      />
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        )}
      </Card>

      {selected && (
        <AppModal
          app={selected}
          onClose={() => setSelected(null)}
          onRemoved={loadApps}
        />
      )}
    </div>
  )
}

function FilterPill({ label, icon: Icon, accent, count, active, onClick }: {
  label: string
  icon: LucideIcon
  accent: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 pl-2.5 pr-2 py-1.5 rounded-xl text-xs font-medium border transition-colors ${
        active
          ? 'bg-dark-400 border-dark-300 text-text-primary'
          : 'bg-dark-700 border-dark-500 text-text-secondary hover:bg-dark-600'
      }`}
    >
      <Icon size={14} className={active ? accent : 'text-text-muted'} />
      {label}
      <span className={`ml-0.5 px-1.5 py-0.5 rounded-md text-[10px] ${active ? 'bg-dark-600 text-text-secondary' : 'bg-dark-500 text-text-muted'}`}>
        {count}
      </span>
    </button>
  )
}
