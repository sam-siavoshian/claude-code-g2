import { Routes, Route } from 'react-router'
import { AppShell, NavHeader } from 'even-toolkit/web'
import { Connect } from './screens/Connect'
import { AppGlasses } from './glass/AppGlasses'

// Companion pane lives on the phone WebView; AppGlasses runs the glasses UI.
// They share the single store in src/store.ts so either side stays in sync.
//
// The /g/* routes exist purely so react-router accepts the navigate() calls
// AppGlasses makes when the store mode changes — useGlasses uses
// location.pathname to drive its screen router.

function Shell() {
  return (
    <AppShell header={<NavHeader title="Claude Code G2" />}>
      <Connect />
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
