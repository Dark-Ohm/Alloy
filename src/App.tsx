import { useEffect } from 'react'
import { useStore } from '@/store'
import { Sidebar } from '@/components/Sidebar'
import { NewsPage } from '@/pages/NewsPage'
import { DropZone } from '@/components/DropZone'
import { PackagesPage } from '@/pages/PackagesPage'
import { SystemUpdatePage } from '@/pages/SystemUpdatePage'
import { MaintenancePage } from '@/pages/MaintenancePage'
import { ConfigPage } from '@/pages/ConfigPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { ApplicationsPage } from '@/pages/ApplicationsPage'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

export default function App() {
  const currentPage = useStore((s) => s.currentPage)
  const setErrorBanner = useStore((s) => s.setErrorBanner)
  const checkDeps = useStore((s) => s.checkDeps)

  useEffect(() => {
    checkDeps()
  }, [checkDeps])

  // Check for updates periodically
  useEffect(() => {
    const checkUpdates = async () => {
      try {
        const hasUpdates = await invoke<boolean>('check_for_updates')
        if (hasUpdates) {
          setErrorBanner('System updates available — open System Update page to review')
        }
      } catch (e) {
        console.error('Failed to check for updates:', e)
        // Don't show banner for background update check failures
      }
    }
    checkUpdates()
    const interval = setInterval(checkUpdates, 30 * 60 * 1000)
    return () => clearInterval(interval)
  }, [setErrorBanner])

  // Listen for tray-triggered update check
  useEffect(() => {
    let unlisten: (() => void) | null = null
    listen('check-updates', async () => {
      try {
        const hasUpdates = await invoke<boolean>('check_for_updates')
        if (hasUpdates) {
          setErrorBanner('System updates available — open System Update page to review')
        }
      } catch (e) {
        console.error('Failed to check for updates:', e)
      }
    }).then(fn => { unlisten = fn })
    return () => { if (unlisten) unlisten() }
  }, [setErrorBanner])

  return (
    <div className="h-screen w-screen flex overflow-hidden bg-dark-900">
      <Sidebar />
      <main className="flex-1 overflow-hidden">
        <div className="h-full">
          {currentPage === 'news' && <NewsPage />}
          {currentPage === 'drop' && <DropZone />}
          {currentPage === 'packages' && <PackagesPage />}
          {currentPage === 'update' && <SystemUpdatePage />}
          {currentPage === 'apps' && <ApplicationsPage />}
          {currentPage === 'maintenance' && <MaintenancePage />}
          {currentPage === 'config' && <ConfigPage />}
          {currentPage === 'settings' && <SettingsPage />}
        </div>
      </main>
    </div>
  )
}
