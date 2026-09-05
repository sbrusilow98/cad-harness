import { useEffect } from 'react'
import '@/styles/theme.css'
import '@/styles/app.css'
import { useUiStore } from '@/store/ui'
import { Canvas } from '@/components/Canvas'

export default function App() {
  const loadSettings = useUiStore((s) => s.loadSettings)
  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  return (
    <div className="app">
      <header className="topbar" />
      <Canvas />
    </div>
  )
}
