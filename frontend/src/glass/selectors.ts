import { createGlassScreenRouter, type GlassScreen } from 'even-toolkit/glass-screen-router'
import type { AppMode } from '../types'
import type { AppSnapshot, AppActions } from './shared'
import { sidebarScreen } from './screens/sidebar'
import { recordingScreen } from './screens/recording'
import { pickingScreen } from './screens/picking'
import { sessionScreen } from './screens/session'

export type { AppSnapshot, AppActions }

// Excludes 'unconfigured'; the app stays on the splash until credentials arrive.
type RoutableMode = Exclude<AppMode, 'unconfigured'>

const screens: Record<RoutableMode, GlassScreen<AppSnapshot, AppActions>> = {
  'sidebar': sidebarScreen,
  'recording-new': recordingScreen,
  'transcribing': recordingScreen,
  'picking-project': pickingScreen,
  'session': sessionScreen,
  'recording-turn': recordingScreen,
}

export const { toDisplayData, onGlassAction } = createGlassScreenRouter(screens, 'sidebar')
