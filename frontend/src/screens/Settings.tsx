import { useEffect, useState } from 'react'
import { Badge, Button, Select, Divider } from 'even-toolkit/web'
import type { SelectOption } from 'even-toolkit/web'
import { getSettings, saveSettings, type Settings as SettingsData, type PermissionMode } from '../api'
import { useAppState } from '../store'

const PERM_OPTS: { value: PermissionMode; label: string; hint: string }[] = [
  { value: 'bypassPermissions', label: 'Skip all (recommended)', hint: '--dangerously-skip-permissions' },
  { value: 'acceptEdits', label: 'Auto-accept edits', hint: 'gates Bash + dangerous tools' },
  { value: 'default', label: 'Prompt every time', hint: 'not hands-free' },
]

const MODEL_OPTS: { value: string; label: string }[] = [
  { value: 'sonnet', label: 'Sonnet (fast)' },
  { value: 'opus', label: 'Opus (smart)' },
  { value: 'haiku', label: 'Haiku (cheap)' },
]

export function SettingsCard() {
  const state = useAppState()
  const [settings, setSettings] = useState<SettingsData | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const configured = Boolean(state.backendUrl && state.token && state.connection === 'ok')

  useEffect(() => {
    if (!configured) { setSettings(null); return }
    void (async () => {
      try {
        const s = await getSettings()
        setSettings(s)
        setError(null)
      } catch (err) {
        setError((err as Error).message)
      }
    })()
  }, [configured])

  async function update(partial: Partial<SettingsData>) {
    if (!settings) return
    setSaving(true)
    setSettings({ ...settings, ...partial })
    try {
      const next = await saveSettings(partial)
      setSettings((cur) => cur ? { ...cur, ...next } : cur)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (!configured) return null

  if (error && !settings) {
    return (
      <div className="rounded bg-negative/10 px-3 py-2 flex items-center justify-between">
        <span className="text-normal-detail text-negative">{error}</span>
        <Button variant="ghost" size="sm" onClick={() => setError(null)}>×</Button>
      </div>
    )
  }

  if (!settings) {
    return <div className="text-normal-detail text-text-dim">loading settings…</div>
  }

  const permHint = PERM_OPTS.find((m) => m.value === settings.permissionMode)?.hint ?? ''

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-normal-subtitle">Settings</span>
        {saving && <Badge>saving…</Badge>}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-normal-detail text-text-dim">Permissions</label>
          <Select
            value={settings.permissionMode}
            options={PERM_OPTS.map<SelectOption>((m) => ({ value: m.value, label: m.label }))}
            onValueChange={(v) => void update({ permissionMode: v as PermissionMode })}
          />
          <div className="text-normal-detail text-text-dim font-mono text-xs">{permHint}</div>
        </div>

        <div className="space-y-1">
          <label className="text-normal-detail text-text-dim">Model</label>
          <Select
            value={settings.model}
            options={MODEL_OPTS}
            onValueChange={(v) => void update({ model: v })}
          />
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-normal-detail text-text-dim">Default project</label>
        <Select
          value={settings.defaultProjectName}
          options={settings.projects.map<SelectOption>((p) => ({ value: p.name, label: p.name }))}
          onValueChange={(v) => void update({ defaultProjectName: v })}
        />
      </div>

      {error && (
        <div className="text-normal-detail text-negative">{error}</div>
      )}

      <Divider />
    </div>
  )
}
