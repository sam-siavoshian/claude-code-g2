import type { Request, Response } from 'express'
import OpenAI from 'openai'
import { toFile } from 'openai/uploads'

// POST /api/transcribe. Accepts `audio/wav` or `audio/pcm` (raw 16 kHz s16le
// mono — the glasses format). Raw PCM gets a 44-byte RIFF header prepended
// so Whisper accepts it without an ffmpeg hop.

const SAMPLE_RATE = 16_000
const CHANNELS = 1
const BITS_PER_SAMPLE = 16

let clientSingleton: OpenAI | null = null
function client(): OpenAI {
  if (clientSingleton) return clientSingleton
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY is not set')
  clientSingleton = new OpenAI({ apiKey: key })
  return clientSingleton
}

export function pcmToWav(
  pcm: Buffer,
  sampleRate = SAMPLE_RATE,
  channels = CHANNELS,
  bitsPerSample = BITS_PER_SAMPLE,
): Buffer {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8
  const blockAlign = (channels * bitsPerSample) / 8
  const dataSize = pcm.length
  const chunkSize = 36 + dataSize

  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(chunkSize, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16) // subchunk1 size
  header.writeUInt16LE(1, 20)  // PCM
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(bitsPerSample, 34)
  header.write('data', 36)
  header.writeUInt32LE(dataSize, 40)

  return Buffer.concat([header, pcm])
}

export async function transcribeHandler(req: Request, res: Response): Promise<void> {
  const body = req.body
  if (!Buffer.isBuffer(body) || body.length === 0) {
    res.status(400).json({ error: 'empty audio body' })
    return
  }

  const contentType = (req.header('content-type') ?? '').toLowerCase().split(';')[0]!.trim()
  let wavBuffer: Buffer
  if (contentType === 'audio/wav' || contentType === 'audio/wave' || contentType === 'audio/x-wav') {
    wavBuffer = body
  } else if (contentType === 'audio/pcm' || contentType === 'application/octet-stream' || contentType === '') {
    // Glasses mic audio is raw PCM. Wrap in a WAV header.
    wavBuffer = pcmToWav(body)
  } else {
    res.status(400).json({ error: `unsupported content-type: ${contentType}` })
    return
  }

  try {
    const file = await toFile(wavBuffer, 'audio.wav', { type: 'audio/wav' })
    const result = await client().audio.transcriptions.create({
      file,
      model: 'whisper-1',
      language: 'en',
      response_format: 'json',
    })
    res.json({ text: result.text.trim() })
  } catch (err) {
    console.error('[transcribe] openai error:', err)
    res.status(502).json({ error: 'transcription_failed' })
  }
}
