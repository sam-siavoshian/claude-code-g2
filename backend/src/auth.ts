import * as crypto from 'node:crypto'
import type { Request, Response, NextFunction } from 'express'

// Constant-time bearer token check.
export function checkToken(expected: string, presented: string | undefined | null): boolean {
  if (!presented) return false
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(presented, 'utf8')
  if (a.length !== b.length) return false
  try {
    return crypto.timingSafeEqual(a, b)
  } catch {
    return false
  }
}

// Parse Authorization: Bearer <token>
export function extractHeaderToken(req: Request): string | null {
  const h = req.header('authorization') ?? req.header('Authorization')
  if (!h) return null
  const m = /^Bearer\s+(.+)$/i.exec(h.trim())
  return m ? m[1]!.trim() : null
}

// Accept the token from the Authorization header OR the ?token= query param
// (EventSource cannot set headers, so SSE must use the query param).
export function extractToken(req: Request): string | null {
  const headerTok = extractHeaderToken(req)
  if (headerTok) return headerTok
  const q = req.query.token
  if (typeof q === 'string' && q.length > 0) return q
  return null
}

export function bearerAuth(expectedToken: string) {
  return function (req: Request, res: Response, next: NextFunction) {
    const presented = extractToken(req)
    if (!checkToken(expectedToken, presented)) {
      res.status(401).json({ error: 'unauthorized' })
      return
    }
    next()
  }
}
