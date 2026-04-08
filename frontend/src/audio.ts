import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'

// Audio capture from the glasses mic array.
//
// audioControl is a singleton on the glasses — only one capture session can
// be active at a time. We enforce that with a module-level `active` flag.

let chunks: Uint8Array[] = []
let unsubscribe: (() => void) | null = null
let active = false

async function getBridge() {
  return waitForEvenAppBridge()
}

export async function startCapture(): Promise<void> {
  if (active) return
  const bridge = await getBridge()
  chunks = []
  unsubscribe = bridge.onEvenHubEvent((event) => {
    const ae = event.audioEvent
    if (!ae) return
    const pcm = ae.audioPcm
    if (pcm && pcm.length > 0) {
      // Defensive copy: the SDK may reuse its underlying buffer.
      chunks.push(new Uint8Array(pcm))
    }
  })
  try {
    await bridge.audioControl(true)
    active = true
  } catch (err) {
    unsubscribe?.()
    unsubscribe = null
    throw err
  }
}

export async function stopCapture(): Promise<Uint8Array | null> {
  if (!active) return null
  const bridge = await getBridge()
  try {
    await bridge.audioControl(false)
  } catch (err) {
    console.warn('[audio] audioControl(false) failed:', err)
  }
  unsubscribe?.()
  unsubscribe = null
  active = false

  if (chunks.length === 0) return null
  const total = chunks.reduce((sum, c) => sum + c.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }
  chunks = []
  return out
}
