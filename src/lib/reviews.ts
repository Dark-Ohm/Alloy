import type { AppReactions, AppReview } from '@/types'

const KEY = (pkg: string) => `alloy.reviews.${pkg}`

function seed(pkg: string): AppReactions {
  // Deterministic pseudo-seed so cards aren't empty on first view.
  let h = 0
  for (let i = 0; i < pkg.length; i++) h = (h * 31 + pkg.charCodeAt(i)) >>> 0
  return {
    likes: h % 240,
    dislikes: h % 17,
    userVote: null,
    reviews: [],
  }
}

export function getReactions(pkg: string): AppReactions {
  try {
    const raw = localStorage.getItem(KEY(pkg))
    if (raw) return JSON.parse(raw) as AppReactions
  } catch { /* noop */ }
  return seed(pkg)
}

export function saveReactions(pkg: string, data: AppReactions): void {
  try { localStorage.setItem(KEY(pkg), JSON.stringify(data)) } catch { /* noop */ }
}

export function toggleVote(pkg: string, vote: 'like' | 'dislike'): AppReactions {
  const r = getReactions(pkg)
  // undo previous vote
  if (r.userVote === 'like') r.likes = Math.max(0, r.likes - 1)
  if (r.userVote === 'dislike') r.dislikes = Math.max(0, r.dislikes - 1)
  if (r.userVote === vote) {
    r.userVote = null // toggled off
  } else {
    r.userVote = vote
    if (vote === 'like') r.likes += 1
    else r.dislikes += 1
  }
  saveReactions(pkg, r)
  return r
}

export function addReview(pkg: string, review: Omit<AppReview, 'id' | 'date'>): AppReactions {
  const r = getReactions(pkg)
  const full: AppReview = {
    ...review,
    id: `${pkg}-${r.reviews.length}-${review.author}`,
    date: new Date().toISOString(),
  }
  r.reviews = [full, ...r.reviews]
  saveReactions(pkg, r)
  return r
}
