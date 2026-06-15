import { useState, useCallback, useEffect, useMemo } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useStore } from '@/store'
import { Card, ActionButton, ErrorBanner, SectionTitle, Spinner } from '@/components/ui'
import { Rocket, RefreshCw, Search, Briefcase, Gamepad2, Wrench, Clapperboard, LayoutGrid } from 'lucide-react'
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

function AppTile({ app, launching, disabled, onLaunch }: {
  app: AppEntry
  launching: boolean
  disabled: boolean
  onLaunch: (desktopPath: string, name: string) => void
}) {
  const [broken, setBroken] = useState(false)
  const showImg = app.iconDataUri && !broken
  return (
    <button
      onClick={() => onLaunch(app.desktopPath, app.name)}
      disabled={disabled}
      title={app.name}
      className="p-3 bg-dark-700 rounded-xl hover:bg-dark-500 hover:-translate-y-0.5 transition-all duration-150 flex flex-col items-center gap-2 text-center disabled:cursor-not-allowed"
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
      {launching && <Spinner size={12} className="text-accent-green" />}
    </button>
  )
}

const GRID = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3'

export function ApplicationsPage() {
  const store = useStore()
  const [apps, setApps] = useState<AppEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [launching, setLaunching] = useState<string | null>(null)
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

  const handleLaunch = useCallback(async (desktopPath: string, appName: string) => {
    setLaunching(appName)
    try {
      await invoke('launch_app', { desktop_path: desktopPath })
    } catch (e) {
      store.setErrorBanner(`Failed to launch ${appName}: ${e}`)
    }
    setLaunching(null)
  }, [store])

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
                        launching={launching === app.name}
                        disabled={launching !== null}
                        onLaunch={handleLaunch}
                      />
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        )}
      </Card>
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
