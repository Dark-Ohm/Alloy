import { useEffect } from 'react'
import { useStore } from '@/store'
import { Sidebar } from '@/components/Sidebar'
import { DropZone } from '@/components/DropZone'
import { PackagesPage } from '@/pages/PackagesPage'
import { SystemUpdatePage } from '@/pages/SystemUpdatePage'
import { MaintenancePage } from '@/pages/MaintenancePage'
import { ConfigPage } from '@/pages/ConfigPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { ApplicationsPage } from '@/pages/ApplicationsPage'

export default function App() {
  const currentPage = useStore((s) => s.currentPage)
  const checkDeps = useStore((s) => s.checkDeps)

  useEffect(() => {
    checkDeps()
  }, [checkDeps])

  return (
    <div className="h-screen w-screen flex overflow-hidden bg-dark-900">
      <Sidebar />
      <main className="flex-1 overflow-hidden">
        <div className="h-full">
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
