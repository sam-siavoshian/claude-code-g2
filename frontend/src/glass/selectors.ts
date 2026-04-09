import { createGlassScreenRouter, type GlassScreen } from 'even-toolkit/glass-screen-router'
import type { AppMode } from '../types'
import type { AppSnapshot, AppActions } from './shared'
import { mainScreen } from './screens/main'
import { recordingScreen } from './screens/recording'
import { pickingScreen } from './screens/picking'

export type { AppSnapshot, AppActions }

// Excludes 'unconfigured'; the app stays on the splash until credentials arrive.
type RoutableMode = Exclude<AppMode, 'unconfigured'>

const screens: Record<RoutableMode, GlassScreen<AppSnapshot, AppActions>> = {
  'main': mainScreen,
  'recording-new': recordingScreen,
  'transcribing': recordingScreen,
  'picking-project': pickingScreen,
  'recording-turn': recordingScreen,
}

export const { toDisplayData, onGlassAction } = createGlassScreenRouter(screens, 'main')
