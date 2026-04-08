import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as crypto from 'node:crypto'

export interface ProjectEntry {
  name: string
  path: string
}

export interface ConfigFile {
  token: string
  projects: ProjectEntry[]
  defaultProjectName: string
  claudeBinary: string
  openaiApiKey?: string
}

export interface RuntimeConfig extends ConfigFile {
  configPath: string
  configDir: string
  sessionsPath: string
}

const CONFIG_DIR = path.join(os.homedir(), '.cc-g2')
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json')
const SESSIONS_PATH = path.join(CONFIG_DIR, 'sessions.json')

function defaultConfig(): ConfigFile {
  const homeCoding = path.join(os.homedir(), 'Desktop', 'Coding Stuff')
  return {
    token: crypto.randomBytes(32).toString('base64url'),
    projects: [
      {
        name: 'g2',
        path: path.join(homeCoding, 'Side Projects', 'Claude Code G2'),
      },
      {
        name: 'coding',
        path: homeCoding,
      },
      {
        name: 'home',
        path: os.homedir(),
      },
    ],
    defaultProjectName: 'g2',
    claudeBinary: 'claude',
  }
}

export function loadConfig(): RuntimeConfig {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 })

  let cfg: ConfigFile
  let created = false
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf8')
      cfg = JSON.parse(raw) as ConfigFile
    } catch (err) {
      console.error(`[config] failed to parse ${CONFIG_PATH}:`, err)
      console.error(`[config] falling back to defaults; your original file is untouched`)
      cfg = defaultConfig()
    }
  } else {
    cfg = defaultConfig()
    created = true
  }

  // Ensure a token exists (even on an existing file that pre-dates this field)
  if (!cfg.token || cfg.token.length < 16) {
    cfg.token = crypto.randomBytes(32).toString('base64url')
    created = true
  }

  if (created) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 })
  }

  // Fix perms on the config file defensively, even if it already existed
  try {
    fs.chmodSync(CONFIG_PATH, 0o600)
  } catch {
    /* best effort */
  }

  // Validate project paths; keep only directories that actually exist
  const validProjects: ProjectEntry[] = []
  for (const p of cfg.projects ?? []) {
    try {
      const st = fs.statSync(p.path)
      if (st.isDirectory()) {
        validProjects.push(p)
      } else {
        console.warn(`[config] project "${p.name}" path is not a directory, skipping: ${p.path}`)
      }
    } catch {
      console.warn(`[config] project "${p.name}" path missing, skipping: ${p.path}`)
    }
  }
  cfg.projects = validProjects

  if (!validProjects.some((p) => p.name === cfg.defaultProjectName) && validProjects.length > 0) {
    cfg.defaultProjectName = validProjects[0]!.name
  }

  // Surface the token to the operator ONCE on startup (stderr so stdout stays clean for logs)
  const banner = [
    '',
    '════════════════════════════════════════════════════════════════',
    '  Claude Code G2 backend',
    '  Config:   ' + CONFIG_PATH,
    '  Sessions: ' + SESSIONS_PATH,
    '  Projects: ' + validProjects.map((p) => p.name).join(', '),
    '',
    '  BEARER TOKEN:',
    '  ' + cfg.token,
    '',
    '  Paste the token + the backend URL into the glasses app once.',
    '════════════════════════════════════════════════════════════════',
    '',
  ].join('\n')
  console.error(banner)

  return {
    ...cfg,
    configPath: CONFIG_PATH,
    configDir: CONFIG_DIR,
    sessionsPath: SESSIONS_PATH,
  }
}
