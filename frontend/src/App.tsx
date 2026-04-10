import { Routes, Route } from 'react-router'
import { AppShell, NavHeader } from 'even-toolkit/web'
import { Connect } from './screens/Connect'
import { SettingsCard } from './screens/Settings'
import { AppGlasses } from './glass/AppGlasses'

// Companion pane = phone WebView. Dense dashboard, no card-soup.
// AppGlasses runs the glasses UI — both share src/store.ts.

function Shell() {
  return (
    <AppShell header={<NavHeader title="Claude Code G2" />}>
      <div className="px-3 pt-2 pb-8 space-y-3">
        <Connect />
        <SettingsCard />
      </div>
      <AppGlasses />
    </AppShell>
  )
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Shell />} />
      <Route path="/g/*" element={<Shell />} />
    </Routes>
  )
}
