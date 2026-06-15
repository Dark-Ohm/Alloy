import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import {
  Download, Trash2, ThumbsUp, ThumbsDown, Star, ArrowLeft, GitBranch, Users, Send,
} from 'lucide-react'
import clsx from 'clsx'
import type { SearchResult, AppReactions } from '@/types'
import { ActionButton, Badge, Spinner } from '@/components/ui'
import { getReactions, toggleVote, addReview } from '@/lib/reviews'

const ICON_ACCENTS = [
  'bg-accent-blue/20 text-accent-blue',
  'bg-accent-purple/20 text-accent-purple',
  'bg-accent-green/20 text-accent-green',
  'bg-accent-cyan/20 text-accent-cyan',
  'bg-accent-orange/20 text-accent-orange',
  'bg-accent-yellow/20 text-accent-yellow',
  'bg-accent-red/20 text-accent-red',
]

function accentFor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return ICON_ACCENTS[h % ICON_ACCENTS.length]
}

/** Icon component: tries real icon first, falls back to letter avatar */
function AppIcon({ name, iconUri, size, className }: { name: string; iconUri?: string | null; size: 'card' | 'hero'; className?: string }) {
  const [broken, setBroken] = useState(false)
  const dims = size === 'hero'
    ? 'w-24 h-24 text-4xl rounded-3xl'
    : 'w-14 h-14 text-xl rounded-2xl'
  const showImg = iconUri && !broken
  return (
    <div className={clsx('flex items-center justify-center shrink-0 overflow-hidden', dims, className ?? accentFor(name))}>
      {showImg ? (
        <img src={iconUri!} alt={name} className="w-full h-full object-contain" onError={() => setBroken(true)} />
      ) : (
        <span className="font-bold">{name.charAt(0).toUpperCase()}</span>
      )}
    </div>
  )
}

/** Async icon resolver — fetches from Tauri backend on mount */
function useIcon(name: string): string | undefined {
  const [icon, setIcon] = useState<string | undefined>(undefined)
  useEffect(() => {
    let cancelled = false
    invoke<string | null>('resolve_icon', { name }).then((uri) => {
      if (!cancelled && uri) setIcon(uri)
    }).catch(() => {}) // fall back to letter-avatar on error
    return () => { cancelled = true }
  }, [name])
  return icon
}

function ratingAvg(r: AppReactions): number {
  if (r.reviews.length === 0) return 0
  return r.reviews.reduce((a, b) => a + b.rating, 0) / r.reviews.length
}

function Stars({ value, onPick }: { value: number; onPick?: (n: number) => void }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          disabled={!onPick}
          onClick={() => onPick?.(n)}
          className={clsx(onPick && 'cursor-pointer hover:scale-110 transition-transform')}
        >
          <Star
            size={onPick ? 20 : 14}
            className={n <= Math.round(value) ? 'text-accent-yellow fill-accent-yellow' : 'text-dark-300'}
          />
        </button>
      ))}
    </div>
  )
}

/* ---------------- Store grid of cards ---------------- */

export function StoreGrid({ results, onOpen }: {
  results: SearchResult[]
  onOpen: (pkg: SearchResult) => void
}) {
  if (results.length === 0) {
    return <p className="text-center text-text-muted text-sm py-12">Search the AUR to browse apps in the store.</p>
  }
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
      {results.map((r, i) => (
        <StoreCard key={i} pkg={r} onOpen={() => onOpen(r)} />
      ))}
    </div>
  )
}

function StoreCard({ pkg, onOpen }: { pkg: SearchResult; onOpen: () => void }) {
  const icon = useIcon(pkg.name)
  return (
    <button
      onClick={onOpen}
      className="card-hover text-left flex flex-col gap-3 p-4 group"
    >
      <div className="flex items-center gap-3">
        <AppIcon name={pkg.name} iconUri={icon} size="card" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-text-primary truncate group-hover:text-accent-blue transition-colors">{pkg.name}</p>
          <p className="text-xs text-accent-green font-mono truncate">{pkg.version}</p>
        </div>
        <Badge color={pkg.repo === 'aur' ? 'purple' : pkg.installed ? 'green' : 'blue'}>{pkg.repo || 'local'}</Badge>
      </div>
      <p className="text-xs text-text-muted line-clamp-2 min-h-[2rem]">{pkg.description || 'No description available.'}</p>
      <div className="flex items-center justify-between mt-auto pt-1">
        <span className="text-[11px] text-text-muted inline-flex items-center gap-1">
          {typeof pkg.votes === 'number' && <><Users size={11} /> {pkg.votes}</>}
        </span>
        <span className="text-[11px] text-accent-blue font-medium opacity-0 group-hover:opacity-100 transition-opacity">View →</span>
      </div>
    </button>
  )
}

/* ---------------- Full-screen app page overlay ---------------- */

export function AppPage({ pkg, installed, busy, onClose, onInstall, onUninstall, onTree }: {
  pkg: SearchResult
  installed: boolean
  busy: boolean
  onClose: () => void
  onInstall: () => void
  onUninstall: () => void
  onTree: (mode: 'forward' | 'reverse', name: string) => void
}) {
  const [info, setInfo] = useState<string>('')
  const icon = useIcon(pkg.name)
  const [reactions, setReactions] = useState<AppReactions>(() => getReactions(pkg.name))
  const [author, setAuthor] = useState('')
  const [comment, setComment] = useState('')
  const [rating, setRating] = useState(5)

  useEffect(() => {
    setReactions(getReactions(pkg.name))
    invoke<[string, string, number]>('pacman_info', { name: pkg.name })
      .then(([o]) => setInfo(o))
      .catch(() => setInfo(''))
  }, [pkg.name])

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [onClose])

  const vote = useCallback((v: 'like' | 'dislike') => setReactions(toggleVote(pkg.name, v)), [pkg.name])

  const submitReview = useCallback(() => {
    if (!comment.trim()) return
    setReactions(addReview(pkg.name, { author: author.trim() || 'Anonymous', rating, comment: comment.trim() }))
    setComment(''); setAuthor(''); setRating(5)
  }, [pkg.name, author, comment, rating])

  const avg = ratingAvg(reactions)

  return (
    <div className="fixed inset-0 z-50 bg-dark-900/80 backdrop-blur-sm animate-fade-in flex flex-col">
      <div className="mx-auto w-full max-w-4xl h-full flex flex-col bg-dark-800 border-x border-dark-400 shadow-2xl animate-slide-up overflow-hidden">
        {/* top bar */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-dark-400 shrink-0">
          <button onClick={onClose} className="inline-flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary transition-colors">
            <ArrowLeft size={16} /> Back to store
          </button>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary text-2xl leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* hero */}
          <div className="px-8 pt-8 pb-6 flex items-start gap-6 border-b border-dark-400">
            <AppIcon name={pkg.name} iconUri={icon} size="hero" />
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-bold text-text-primary">{pkg.name}</h1>
              <p className="text-sm text-accent-green font-mono mt-1">{pkg.version}</p>
              <div className="flex flex-wrap items-center gap-2 mt-3">
                <Badge color={pkg.repo === 'aur' ? 'purple' : 'blue'}>{pkg.repo || 'local'}</Badge>
                {typeof pkg.votes === 'number' && <Badge color="yellow"><Users size={11} /> {pkg.votes} votes</Badge>}
                {reactions.reviews.length > 0 && (
                  <span className="inline-flex items-center gap-1 text-xs text-text-muted">
                    <Stars value={avg} /> {avg.toFixed(1)} ({reactions.reviews.length})
                  </span>
                )}
              </div>
            </div>
            <div className="shrink-0">
              {installed ? (
                <ActionButton variant="danger" onClick={onUninstall} disabled={busy} className="px-6 py-3 text-base">
                  {busy ? <Spinner size={16} /> : <Trash2 size={16} />} Uninstall
                </ActionButton>
              ) : (
                <ActionButton variant="success" onClick={onInstall} disabled={busy} className="px-6 py-3 text-base">
                  {busy ? <Spinner size={16} /> : <Download size={16} />} Install
                </ActionButton>
              )}
            </div>
          </div>

          {/* description + actions */}
          <div className="px-8 py-6 space-y-5">
            <section>
              <h2 className="text-sm font-semibold text-text-primary mb-2">About</h2>
              <p className="text-sm text-text-secondary leading-relaxed">{pkg.description || 'No description available.'}</p>
              <div className="flex items-center gap-2 mt-4">
                <ActionButton variant="ghost" onClick={() => onTree('forward', pkg.name)}><GitBranch size={14} /> Dependencies</ActionButton>
                <ActionButton variant="ghost" onClick={() => onTree('reverse', pkg.name)}><GitBranch size={14} /> Required by</ActionButton>
              </div>
            </section>

            {/* like / dislike */}
            <section className="flex items-center gap-3">
              <button
                onClick={() => vote('like')}
                className={clsx('inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border transition-all',
                  reactions.userVote === 'like' ? 'bg-accent-green/20 border-accent-green/40 text-accent-green' : 'bg-dark-600 border-dark-400 text-text-secondary hover:border-accent-green/30')}
              >
                <ThumbsUp size={15} /> {reactions.likes}
              </button>
              <button
                onClick={() => vote('dislike')}
                className={clsx('inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border transition-all',
                  reactions.userVote === 'dislike' ? 'bg-accent-red/20 border-accent-red/40 text-accent-red' : 'bg-dark-600 border-dark-400 text-text-secondary hover:border-accent-red/30')}
              >
                <ThumbsDown size={15} /> {reactions.dislikes}
              </button>
            </section>

            {/* reviews */}
            <section>
              <h2 className="text-sm font-semibold text-text-primary mb-3">Reviews ({reactions.reviews.length})</h2>

              {/* write a review */}
              <div className="card mb-4 space-y-3">
                <div className="flex items-center justify-between">
                  <input
                    className="input max-w-xs"
                    placeholder="Your name"
                    value={author}
                    onChange={(e) => setAuthor(e.target.value)}
                  />
                  <Stars value={rating} onPick={setRating} />
                </div>
                <textarea
                  className="input resize-none h-20"
                  placeholder="Share your experience with this app..."
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
                <div className="flex justify-end">
                  <ActionButton variant="primary" onClick={submitReview} disabled={!comment.trim()}>
                    <Send size={14} /> Post review
                  </ActionButton>
                </div>
              </div>

              {reactions.reviews.length === 0 ? (
                <p className="text-center text-text-muted text-sm py-6">No reviews yet. Be the first!</p>
              ) : (
                <div className="space-y-3">
                  {reactions.reviews.map((rev) => (
                    <div key={rev.id} className="card flex gap-3">
                      <div className={clsx('w-10 h-10 rounded-full flex items-center justify-center font-semibold shrink-0', accentFor(rev.author))}>
                        {rev.author.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium text-text-primary truncate">{rev.author}</span>
                          <span className="text-[11px] text-text-muted shrink-0">{new Date(rev.date).toLocaleDateString()}</span>
                        </div>
                        <Stars value={rev.rating} />
                        <p className="text-sm text-text-secondary mt-1.5 break-words">{rev.comment}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {info && (
              <section>
                <h2 className="text-sm font-semibold text-text-primary mb-2">Package details</h2>
                <div className="log-console max-h-60">{info}</div>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
