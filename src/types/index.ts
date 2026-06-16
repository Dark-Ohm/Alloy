// ── Shared types mirroring Rust models ────────────────────────────────

export interface DepStatus {
  installed: boolean
  path: string | null
}

export interface SystemDeps {
  pacman: DepStatus
  yay: DepStatus
  debtap: DepStatus
  fish: DepStatus
  pkexec: DepStatus
  makepkg: DepStatus
}

export interface StreamEvent {
  kind: 'stdout' | 'stdoutRedraw' | 'stderr' | 'progress' | 'transactionSummary' | 'exit' | 'error'
  line?: string
  code?: number
  message?: string
  pkgName?: string
  pkgNum?: number
  pkgTotal?: number
  pct?: number
  totalPackages?: number
  packageNames?: string[]
}

export interface PackageAnalysis {
  format: string
  filePath: string
  packageName: string
  version: string
  description: string
  dependencies: string[]
  arch: string
  sizeBytes: number
  extractedPath?: string
  desktopFile?: string
}

export interface InstallResult {
  success: boolean
  packageName: string
  pkgPath?: string
  desktopFile?: string
  messages: string[]
}

export interface PkgbuildReview {
  packageName: string
  content: string
}

export interface SearchResult {
  repo: string
  name: string
  version: string
  description: string
  installed?: boolean
  votes?: number
  popularity?: number
}

export interface AppReview {
  id: string
  author: string
  rating: number
  comment: string
  date: string
}

export interface AppReactions {
  likes: number
  dislikes: number
  userVote: 'like' | 'dislike' | null
  reviews: AppReview[]
}

export interface DependencyNode {
  name: string
  depth: number
}

export interface InformantResult {
  informantAvailable: boolean
  hasUnread: boolean
  entries: string[]
  message: string
}

export interface AppImageEntry {
  name: string
  desktopPath: string
  execPath: string
}

export interface AppEntry {
  name: string
  desktopPath: string
  execPath: string
  icon: string
  iconDataUri?: string
  category: string
}

export interface PackageProgress {
  name: string
  pct: number
  status: 'done' | 'active' | 'pending'
}

export interface SecurityScanResult {
  infectedPackages: InfectedPackage[]
  logHits: LogHit[]
  npmCacheHits: string[]
  systemdSuspicious: string[]
  totalCompromised: number
}

export interface InfectedPackage {
  name: string
  installDate: string
}

export interface LogHit {
  package: string
  action: string
  date: string
}

export interface PackageSecurityInfo {
  package: string
  compromised: boolean
  knownCompromisedCount: number
}
