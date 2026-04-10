// Load the Claude logo PNG as a Uint8Array for the glasses image tile.
// Fetched once at startup, cached in memory.

let cached: Uint8Array | null = null

export async function loadClaudeLogo(): Promise<Uint8Array | null> {
  if (cached) return cached
  try {
    const res = await fetch('/claudecode-color.png')
    if (!res.ok) {
      console.warn('[logo] failed to load:', res.status)
      return null
    }
    const buf = await res.arrayBuffer()
    cached = new Uint8Array(buf)
    console.log('[logo] loaded', cached.length, 'bytes')
    return cached
  } catch (err) {
    console.warn('[logo] fetch error:', err)
    return null
  }
}
