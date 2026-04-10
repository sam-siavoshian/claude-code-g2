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

// The SDK type says `audioPcm: Uint8Array`, but the bridge ships PCM across a
// JSON channel — on the wire it arrives as a number[] or a base64 string
// depending on host. Normalize to Uint8Array or we silently drop every chunk
// and stopCapture() returns an empty buffer ("died after listening").
function toUint8(pcm: unknown): Uint8Array | null {
  if (!pcm) return null
  if (pcm instanceof Uint8Array) return new Uint8Array(pcm)
  if (Array.isArray(pcm)) return new Uint8Array(pcm)
  if (typeof pcm === 'string') {
    try {
      const bin = atob(pcm)
      const out = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
      return out
    } catch {
      return null
    }
  }
  if (typeof pcm === 'object' && pcm && 'buffer' in (pcm as ArrayBufferView)) {
    const v = pcm as ArrayBufferView
    return new Uint8Array(v.buffer, v.byteOffset, v.byteLength)
  }
  return null
}

export async function startCapture(): Promise<void> {
  if (active) return
  const bridge = await getBridge()
  chunks = []
  let chunkCount = 0
  unsubscribe = bridge.onEvenHubEvent((event) => {
    const ae = event.audioEvent
    if (!ae) return
    const u8 = toUint8(ae.audioPcm as unknown)
    if (u8 && u8.length > 0) {
      chunks.push(u8)
      chunkCount++
      if (chunkCount === 1) console.log('[audio] first chunk', u8.length, 'bytes')
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

  console.log('[audio] stopCapture:', chunks.length, 'chunks')
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
