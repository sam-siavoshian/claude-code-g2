import { useEffect, useState } from 'react'
import { Card, Button, Select } from 'even-toolkit/web'
import type { SelectOption } from 'even-toolkit/web'
import { getSettings, saveSettings, type Settings as SettingsData, type PermissionMode } from '../api'
import { useAppState } from '../store'

const PERMISSION_MODES: { value: PermissionMode; label: string; hint: string }[] = [
  {
    value: 'bypassPermissions',
    label: 'Skip all permissions (recommended)',
    hint: '--dangerously-skip-permissions · zero prompts · perfect for hands-free voice flow',
  },
  {
    value: 'acceptEdits',
    label: 'Auto-accept edits only',
    hint: 'auto-approves file edits but still gates Bash and other dangerous tools',
  },
  {
    value: 'default',
    label: 'Default (prompt every time)',
    hint: 'Claude pauses for approval on dangerous actions — not usable hands-free',
  },
]

const MODELS: { value: string; label: string }[] = [
  { value: 'sonnet', label: 'Sonnet (fast, default)' },
  { value: 'opus', label: 'Opus (smart, slower, pricier)' },
  { value: 'haiku', label: 'Haiku (cheapest, weakest)' },
]

export function SettingsCard() {
  const state = useAppState()
  const [settings, setSettings] = useState<SettingsData | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const configured = Boolean(state.backendUrl && state.token && state.connection === 'ok')

  useEffect(() => {
    if (!configured) {
      setSettings(null)
      return
    }
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
    // Optimistic UI: apply locally first so the dropdown reflects the choice
    // even if the network call is slow.
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

  if (!configured) {
    return (
      <Card className="p-4">
        <h3 className="text-medium-title">Settings</h3>
        <p className="text-normal-body text-text-dim">Connect first to load settings.</p>
      </Card>
    )
  }

  if (error && !settings) {
    return (
      <Card className="p-4 space-y-2">
        <h3 className="text-medium-title">Settings</h3>
        <p className="text-normal-detail text-negative">{error}</p>
        <Button variant="ghost" size="sm" onClick={() => setError(null)}>Dismiss</Button>
      </Card>
    )
  }

  if (!settings) {
    return (
      <Card className="p-4">
        <h3 className="text-medium-title">Settings</h3>
        <p className="text-normal-body text-text-dim">Loading...</p>
      </Card>
    )
  }

  const currentPermLabel =
    PERMISSION_MODES.find((m) => m.value === settings.permissionMode)?.hint ?? ''

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-medium-title">Settings</h3>
        {saving ? <span className="text-normal-detail text-text-dim">saving…</span> : null}
      </div>

      <div className="space-y-2">
        <label className="text-normal-subtitle">Permission mode</label>
        <Select
          value={settings.permissionMode}
          options={PERMISSION_MODES.map<SelectOption>((m) => ({ value: m.value, label: m.label }))}
          onValueChange={(v) => void update({ permissionMode: v as PermissionMode })}
        />
        <p className="text-normal-detail text-text-dim">{currentPermLabel}</p>
      </div>

      <div className="space-y-2">
        <label className="text-normal-subtitle">Model</label>
        <Select
          value={settings.model}
          options={MODELS}
          onValueChange={(v) => void update({ model: v })}
        />
      </div>

      <div className="space-y-2">
        <label className="text-normal-subtitle">Default project</label>
        <Select
          value={settings.defaultProjectName}
          options={settings.projects.map<SelectOption>((p) => ({ value: p.name, label: p.name }))}
          onValueChange={(v) => void update({ defaultProjectName: v })}
        />
      </div>

      {error ? (
        <p className="text-normal-detail text-negative">{error}</p>
      ) : null}
    </Card>
  )
}
