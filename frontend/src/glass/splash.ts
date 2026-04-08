import { createSplash, TILE_PRESETS } from 'even-toolkit/splash'

export function renderSplash(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const fg = '#e0e0e0'
  const cx = w / 2
  const s = Math.min(w / 200, h / 200)

  ctx.fillStyle = fg
  ctx.font = `bold ${14 * s}px "Courier New", monospace`
  ctx.textAlign = 'center'
  ctx.fillText('CLAUDE CODE G2', cx, 50 * s)
  ctx.textAlign = 'left'
}

export const appSplash = createSplash({
  tiles: 1,
  tileLayout: 'vertical',
  tilePositions: TILE_PRESETS.topCenter1,
  canvasSize: { w: 200, h: 200 },
  minTimeMs: 0,
  maxTimeMs: 0,
  menuText: '',
  render: renderSplash,
})
