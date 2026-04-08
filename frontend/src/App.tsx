import { AppShell, NavHeader } from 'even-toolkit/web'
import { Connect } from './screens/Connect'
import { AppGlasses } from './glass/AppGlasses'

// Companion pane lives on the phone WebView; AppGlasses runs the glasses UI.
// They share the single store in src/store.ts so either side stays in sync.

export function App() {
  return (
    <AppShell header={<NavHeader title="Claude Code G2" />}>
      <Connect />
      <AppGlasses />
    </AppShell>
  )
}
