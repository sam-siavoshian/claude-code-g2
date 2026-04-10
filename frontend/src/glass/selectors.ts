import { createGlassScreenRouter, type GlassScreen } from 'even-toolkit/glass-screen-router'
import type { AppMode } from '../types'
import type { AppSnapshot, AppActions } from './shared'
import { mainScreen } from './screens/main'
import { recordingScreen } from './screens/recording'
import { pickingScreen } from './screens/picking'
import { confirmingScreen } from './screens/confirming'
import { answeringScreen } from './screens/answering'

export type { AppSnapshot, AppActions }

type RoutableMode = Exclude<AppMode, 'unconfigured'>

const screens: Record<RoutableMode, GlassScreen<AppSnapshot, AppActions>> = {
  'main': mainScreen,
  'recording-new': recordingScreen,
  'transcribing': recordingScreen,
  'picking-project': pickingScreen,
  'recording-turn': recordingScreen,
  'confirming-transcript': confirmingScreen,
  'answering': answeringScreen,
}

export const { toDisplayData, onGlassAction } = createGlassScreenRouter(screens, 'main')
