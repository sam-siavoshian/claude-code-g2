// Load and resize the Claude logo PNG for the glasses image tile.
// The G2 display needs images pre-sized to the container dimensions.
// We fetch the source PNG, resize via canvas, and re-encode as PNG bytes.

let cached: Uint8Array | null = null

export async function loadClaudeLogo(): Promise<Uint8Array | null> {
  if (cached) return cached
  try {
    // Load the source image
    const img = new Image()
    img.crossOrigin = 'anonymous'
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('image load failed'))
      img.src = '/claudecode-color.png'
    })

    // Resize to 80x80 via canvas (G2 max tile is 200x100, we use 80x80)
    const SIZE = 80
    const canvas = document.createElement('canvas')
    canvas.width = SIZE
    canvas.height = SIZE
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, SIZE, SIZE)

    // Convert to PNG bytes
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/png'),
    )
    if (!blob) return null
    const buf = await blob.arrayBuffer()
    cached = new Uint8Array(buf)
    console.log('[logo] resized to', SIZE, 'x', SIZE, '—', cached.length, 'bytes')
    return cached
  } catch (err) {
    console.warn('[logo] failed:', err)
    return null
  }
}
