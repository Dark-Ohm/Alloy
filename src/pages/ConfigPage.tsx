import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import Editor from '@monaco-editor/react'
import { useStore } from '@/store'
import { Card, ActionButton, ErrorBanner, LogConsole, SectionTitle, Spinner } from '@/components/ui'
import { FileText, Eye, CheckCircle, Rocket } from 'lucide-react'

export function ConfigPage() {
  const store = useStore()
  const [pkgInput, setPkgInput] = useState('')
  const [fetching, setFetching] = useState(false)
  const [showEditor, setShowEditor] = useState(false)
  const [approved, setApproved] = useState(false)

  const handleFetch = async () => {
    if (!pkgInput.trim()) return
    setFetching(true); setShowEditor(false); setApproved(false)
    try {
      const review = await invoke<{ packageName: string; content: string }>('yay_fetch_pkgbuild', { package: pkgInput.trim() })
      store.setPkgbuildReview(review)
      setShowEditor(true)
    } catch (e) {
      store.setErrorBanner(`Failed to fetch PKGBUILD: ${e}`)
    }
    setFetching(false)
  }

  return (
    <div className="h-full overflow-y-auto p-6 space-y-5">
      <SectionTitle icon={<FileText size={20} className="text-accent-yellow" />}>PKGBUILD Review</SectionTitle>
      {store.errorBanner && <ErrorBanner message={store.errorBanner} onDismiss={store.dismissError} />}

      <Card>
        <p className="text-xs text-text-muted mb-3">Enter an AUR package name to review its PKGBUILD before approving compilation.</p>
        <div className="flex items-center gap-3">
          <input className="input flex-1" placeholder="e.g., google-chrome" value={pkgInput} onChange={(e) => setPkgInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleFetch()} />
          <ActionButton variant="primary" onClick={handleFetch} disabled={fetching}>
            {fetching ? <Spinner size={15} /> : <Eye size={15} />} Review PKGBUILD
          </ActionButton>
        </div>
      </Card>

      {showEditor && store.pkgbuildReview && (
        <Card className="space-y-4 animate-slide-up">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText size={16} className="text-accent-yellow" />
              <span className="text-sm font-semibold text-text-primary">{store.pkgbuildReview.packageName}/PKGBUILD</span>
            </div>
            {!approved ? (
              <div className="flex items-center gap-2">
                <ActionButton variant="ghost" onClick={() => setShowEditor(false)}>Reject</ActionButton>
                <ActionButton variant="success" onClick={() => setApproved(true)}><CheckCircle size={15} /> Approve Compilation</ActionButton>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs text-accent-green font-medium">✓ Approved</span>
                <ActionButton variant="primary" onClick={() => {
                  store.clearLogs()
                  invoke('yay_install', { cmdId: `review-install-${Date.now()}`, packages: [store.pkgbuildReview!.packageName] })
                }}>
                  <Rocket size={15} /> Proceed to Install
                </ActionButton>
              </div>
            )}
          </div>
          <div className="rounded-xl overflow-hidden border border-dark-400" style={{ height: 500 }}>
            <Editor
              height="100%"
              defaultLanguage="shell"
              value={store.pkgbuildReview.content}
              theme="vs-dark"
              options={{
                readOnly: true, minimap: { enabled: false }, fontSize: 13,
                lineNumbers: 'on', scrollBeyondLastLine: false, wordWrap: 'on',
                fontFamily: 'JetBrains Mono, monospace', padding: { top: 12, bottom: 12 },
              }}
            />
          </div>
        </Card>
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
