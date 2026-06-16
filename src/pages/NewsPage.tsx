import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Newspaper, Package, RefreshCw, ExternalLink, WifiOff, Rss, HardDriveDownload } from 'lucide-react'
import clsx from 'clsx'
import { SectionTitle, Spinner } from '@/components/ui'

type NewsItem = { title: string; link: string; date: string; desc: string; pkg: string }
type FeedKey = 'news' | 'packages' | 'installed'

const FEEDS: Record<FeedKey, {
  url: string; label: string; icon: typeof Newspaper; accent: string; dot: string; glow: string
  installedOnly?: boolean
}> = {
  news: {
    url: 'https://archlinux.org/feeds/news/',
    label: 'Arch News',
    icon: Newspaper,
    accent: 'text-accent-blue',
    dot: 'bg-accent-blue',
    glow: 'glow-blue',
  },
  packages: {
    url: 'https://archlinux.org/feeds/packages/',
    label: 'All Updates',
    icon: Package,
    accent: 'text-accent-purple',
    dot: 'bg-accent-purple',
    glow: 'glow-purple',
  },
  installed: {
    url: 'https://archlinux.org/feeds/packages/',
    label: 'Your Packages',
    icon: HardDriveDownload,
    accent: 'text-accent-green',
    dot: 'bg-accent-green',
    glow: 'glow-green',
    installedOnly: true,
  },
}

function decodeHtml(s: string): string {
  const el = document.createElement('textarea')
  el.innerHTML = s
  return el.value
}

function relTime(raw: string): string {
  const t = new Date(raw).getTime()
  if (isNaN(t)) return ''
  const diff = Date.now() - t
  const min = 60_000, hr = 3_600_000, day = 86_400_000
  if (diff < hr) return `${Math.max(1, Math.round(diff / min))}m ago`
  if (diff < day) return `${Math.round(diff / hr)}h ago`
  if (diff < day * 30) return `${Math.round(diff / day)}d ago`
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function absDate(raw: string): string {
  const t = new Date(raw).getTime()
  if (isNaN(t)) return ''
  return new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

// Packages-feed item titles look like "firefox 124.0-1 x86_64" — the first
// whitespace-delimited token is the package name. News-feed titles have no
// meaningful package, so pkg ends up as the leading word and is simply unused.
function parseFeed(xml: string): NewsItem[] {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  if (doc.querySelector('parsererror')) return []
  return Array.from(doc.querySelectorAll('item')).slice(0, 60).map((it) => {
    const title = decodeHtml((it.querySelector('title')?.textContent ?? '').trim())
    return {
      title,
      link: (it.querySelector('link')?.textContent ?? '').trim(),
      date: (it.querySelector('pubDate')?.textContent ?? '').trim(),
      desc: decodeHtml((it.querySelector('description')?.textContent ?? '').replace(/<[^>]+>/g, ' '))
        .replace(/\s+/g, ' ')
        .trim(),
      pkg: title.split(/\s+/)[0]?.toLowerCase() ?? '',
    }
  }).filter((i) => i.title)
}

export function NewsPage() {
  const [tab, setTab] = useState<FeedKey>('news')
  const [loading, setLoading] = useState(false)
  const [offline, setOffline] = useState(false)
  const cache = useRef<Record<FeedKey, NewsItem[]>>({ news: [], packages: [], installed: [] })
  const installedSet = useRef<Set<string> | null>(null)
  const [items, setItems] = useState<NewsItem[]>([])

  const getInstalled = useCallback(async (force = false): Promise<Set<string>> => {
    if (installedSet.current && !force) return installedSet.current
    const [stdout] = await invoke<[string, string, number]>('pacman_list_installed')
    const set = new Set(
      stdout.split('\n').map((l) => l.split(/\s+/)[0]?.toLowerCase()).filter(Boolean),
    )
    installedSet.current = set
    return set
  }, [])

  const load = useCallback(async (key: FeedKey, force = false) => {
    if (!force && cache.current[key].length) {
      setItems(cache.current[key]); setOffline(false); return
    }
    setLoading(true); setOffline(false)
    try {
      const feed = FEEDS[key]
      const [stdout] = await invoke<[string, string, number]>('fish_shot', {
        script: `curl -sL --max-time 10 ${feed.url}`,
      })
      let parsed = parseFeed(stdout)
      if (feed.installedOnly) {
        const set = await getInstalled(force)
        parsed = parsed.filter((i) => set.has(i.pkg))
      }
      if (parsed.length === 0 && !feed.installedOnly) { setOffline(true); setItems([]) }
      else { cache.current[key] = parsed; setItems(parsed) }
    } catch {
      setOffline(true); setItems([])
    }
    setLoading(false)
  }, [getInstalled])

  useEffect(() => { load(tab) }, [tab, load])

  const openLink = useCallback((url: string) => {
    if (!url) return
    const safe = url.replace(/'/g, "'\\''")
    invoke('fish_shot', { script: `xdg-open '${safe}'` }).catch(() => {})
  }, [])

  const feed = FEEDS[tab]
  const empty = !loading && !offline && items.length === 0

  return (
    <div className="h-full flex flex-col p-6 gap-4 overflow-hidden">
      <SectionTitle icon={<Rss size={20} className="text-accent-blue" />}>What's New — Arch Linux</SectionTitle>

      {/* ── Controls ── */}
      <div className="flex items-center gap-3 shrink-0">
        <div className="flex items-center gap-1 p-1 rounded-xl bg-white/[0.03] border border-white/[0.05]">
          {(Object.keys(FEEDS) as FeedKey[]).map((k) => {
            const F = FEEDS[k]
            const Icon = F.icon
            const active = tab === k
            return (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={clsx(
                  'flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all duration-200',
                  active ? 'bg-white/[0.07] text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary',
                )}
              >
                <Icon size={15} className={active ? F.accent : ''} />
                {F.label}
                {active && <span className={clsx('w-1.5 h-1.5 rounded-full animate-pulse-slow', offline ? 'bg-text-muted' : F.dot)} />}
              </button>
            )
          })}
        </div>

        <div className="flex-1" />

        <span className="text-xs text-text-muted hidden sm:block">
          {!loading && !offline && items.length > 0 && `${items.length} ${feed.installedOnly ? 'for you' : 'entries'}`}
        </span>
        <button
          onClick={() => load(tab, true)}
          disabled={loading}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-white/[0.04] border border-white/[0.06] text-text-secondary hover:text-text-primary hover:bg-white/[0.08] transition-all disabled:opacity-50"
          title="Refresh"
        >
          {loading ? <Spinner size={13} /> : <RefreshCw size={13} />}
          Refresh
        </button>
      </div>

      {/* ── Feed grid ── */}
      <div className="flex-1 overflow-y-auto min-h-0 -mx-1 px-1">
        {loading && items.length === 0 ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-[112px] rounded-2xl skeleton" style={{ animationDelay: `${i * 70}ms` }} />
            ))}
          </div>
        ) : offline ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-center">
            <WifiOff size={32} className="text-text-muted" />
            <p className="text-sm text-text-muted">Couldn't reach archlinux.org — check your connection</p>
            <button
              onClick={() => load(tab, true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-accent-blue/10 text-accent-blue hover:bg-accent-blue/20 transition-all"
            >
              <RefreshCw size={14} /> Try again
            </button>
          </div>
        ) : empty ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-center">
            <HardDriveDownload size={32} className="text-text-muted" />
            <p className="text-sm text-text-muted">
              {feed.installedOnly
                ? 'None of your installed packages appear in the latest updates feed'
                : 'Nothing here right now'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 pb-2">
            {items.map((item, i) => {
              const fresh = i === 0
              return (
                <button
                  key={item.link || i}
                  onClick={() => openLink(item.link)}
                  style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}
                  className={clsx(
                    'group text-left relative animate-slide-up',
                    'rounded-2xl p-4 pl-5 border bg-dark-600/50 hover:bg-dark-500/60',
                    'border-white/[0.06] hover:border-white/[0.12] transition-all duration-200 hover:-translate-y-0.5',
                    fresh && feed.glow,
                  )}
                >
                  {/* accent rail */}
                  <span className={clsx('absolute left-0 top-4 bottom-4 w-[3px] rounded-r-full', feed.dot, 'opacity-60 group-hover:opacity-100 transition-opacity')} />

                  <div className="flex items-center gap-2 mb-2">
                    {fresh && (
                      <span className={clsx('text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded', feed.accent, 'bg-white/[0.06]')}>Latest</span>
                    )}
                    {feed.installedOnly && (
                      <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded text-accent-green bg-accent-green/10">Installed</span>
                    )}
                    <span className="text-[11px] text-text-muted font-mono" title={absDate(item.date)}>{relTime(item.date)}</span>
                    <ExternalLink size={12} className="ml-auto text-text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>

                  <h3 className="text-sm font-semibold text-text-primary leading-snug line-clamp-2 group-hover:text-white transition-colors">
                    {item.title}
                  </h3>
                  {item.desc && (
                    <p className="text-xs text-text-muted leading-relaxed mt-1.5 line-clamp-2">{item.desc}</p>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
