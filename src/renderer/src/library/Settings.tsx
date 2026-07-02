import React, { useEffect, useState } from 'react'
import type { Settings } from '@shared/types'
import { api } from '@ui/api'
import { Icon } from '@ui/icons'
import { t, LOCALES } from '@ui/i18n'

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }): React.ReactElement {
  return (
    <div className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)}>
      <div className="knob" />
    </div>
  )
}

function Row({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="set-row">
      <div className="lbl">
        <div className="t">{title}</div>
        {desc && <div className="d">{desc}</div>}
      </div>
      {children}
    </div>
  )
}

const MODELS = [
  { id: 'claude-opus-4-8', labelKey: 'settings.modelOpus' },
  { id: 'claude-sonnet-4-6', labelKey: 'settings.modelSonnet' },
  { id: 'claude-haiku-4-5', labelKey: 'settings.modelHaiku' }
]

export default function Settings({ settings, onClose }: { settings: Settings; onClose: () => void }): React.ReactElement {
  const [tab, setTab] = useState<'general' | 'capture' | 'hotkeys' | 'ai'>('general')
  const [keyInput, setKeyInput] = useState('')
  const [keyStatus, setKeyStatus] = useState<string>('')
  const [mics, setMics] = useState<MediaDeviceInfo[]>([])

  // Populate the recording-microphone list when the General tab is shown. Device labels are
  // blank until the page has been granted mic access once, so unlock them with a throwaway
  // getUserMedia. Failing (mic blocked) just leaves the list empty; "System default" still works.
  useEffect(() => {
    if (tab !== 'general') return
    let cancelled = false
    void (async () => {
      try {
        let devices = await navigator.mediaDevices.enumerateDevices()
        if (devices.some((d) => d.kind === 'audioinput' && !d.label)) {
          const s = await navigator.mediaDevices.getUserMedia({ audio: true })
          s.getTracks().forEach((tr) => tr.stop())
          devices = await navigator.mediaDevices.enumerateDevices()
        }
        if (!cancelled) setMics(devices.filter((d) => d.kind === 'audioinput'))
      } catch {
        /* mic blocked or unavailable */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [tab])

  const set = (patch: Partial<Settings>): void => void api.updateSettings(patch)
  const setHotkey = (k: keyof Settings['hotkeys'], v: string): void => set({ hotkeys: { ...settings.hotkeys, [k]: v } })

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" style={{ width: 560 }} onMouseDown={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>{t('settings.title')}</h2>
          <button className="icon-btn" onClick={onClose}>
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="settings-tabs">
          {(
            [
              ['general', 'settings.tabGeneral'],
              ['capture', 'settings.tabCapture'],
              ['hotkeys', 'settings.tabHotkeys'],
              ['ai', 'settings.tabAi']
            ] as const
          ).map(([tabId, labelKey]) => (
            <button key={tabId} className={tab === tabId ? 'active' : ''} onClick={() => setTab(tabId)}>
              {t(labelKey)}
            </button>
          ))}
        </div>

        <div className="settings-grid">
          {tab === 'general' && (
            <>
              <Row title={t('settings.appearance')} desc={t('settings.appearanceDesc')}>
                <div className="seg" style={{ width: 150 }}>
                  <button className={settings.theme === 'light' ? 'active' : ''} onClick={() => set({ theme: 'light' })}>
                    {t('settings.themeLight')}
                  </button>
                  <button className={settings.theme !== 'light' ? 'active' : ''} onClick={() => set({ theme: 'dark' })}>
                    {t('settings.themeDark')}
                  </button>
                </div>
              </Row>
              {Object.keys(LOCALES).length > 1 && (
                <Row title={t('settings.language')} desc={t('settings.languageDesc')}>
                  <select
                    className="select"
                    style={{ width: 180 }}
                    value={LOCALES[settings.locale] ? settings.locale : 'en'}
                    onChange={(e) => set({ locale: e.target.value })}
                  >
                    {Object.entries(LOCALES).map(([code, { label }]) => (
                      <option key={code} value={code}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Row>
              )}
              <Row title={t('settings.storageFolder')} desc={settings.storageRoot ?? t('settings.notSet')}>
                <button
                  className="btn sm"
                  onClick={async () => {
                    const p = await api.chooseStorageRoot()
                    if (p) set({ storageRoot: p })
                  }}
                >
                  {t('settings.change')}
                </button>
              </Row>
              <Row title={t('settings.launchAtStartup')} desc={t('settings.launchAtStartupDesc')}>
                <Toggle on={settings.launchOnStartup} onChange={(v) => set({ launchOnStartup: v })} />
              </Row>
              <Row title={t('settings.recordingMic')} desc={t('settings.recordingMicDesc')}>
                <select
                  className="select"
                  style={{ width: 220 }}
                  value={settings.recordingMicId}
                  onChange={(e) => set({ recordingMicId: e.target.value })}
                >
                  <option value="">{t('settings.recordingMicDefault')}</option>
                  {mics.map((d, i) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `${t('settings.recordingMic')} ${i + 1}`}
                    </option>
                  ))}
                </select>
              </Row>
              <Row title={t('settings.trashRetention')} desc={t('settings.trashRetentionDesc')}>
                <select
                  className="select"
                  style={{ width: 170 }}
                  value={String(settings.trashRetentionDays)}
                  onChange={(e) => set({ trashRetentionDays: Number(e.target.value) })}
                >
                  <option value="7">{t('settings.retention7')}</option>
                  <option value="14">{t('settings.retention14')}</option>
                  <option value="30">{t('settings.retention30')}</option>
                  <option value="90">{t('settings.retention90')}</option>
                  <option value="0">{t('settings.retentionForever')}</option>
                </select>
              </Row>
              <div>
                <div className="set-row">
                  <div className="lbl">
                    <div className="t">{t('settings.brandPalette')}</div>
                    <div className="d">{t('settings.brandPaletteDesc')}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  {settings.brandColors.map((c, i) => (
                    <input
                      key={i}
                      type="color"
                      value={c}
                      style={{ width: 42, height: 32, border: 'none', background: 'none', borderRadius: 8 }}
                      onChange={(e) => {
                        const next = settings.brandColors.slice()
                        next[i] = e.target.value
                        set({ brandColors: next })
                      }}
                    />
                  ))}
                </div>
              </div>
              {settings.customColors.length > 0 && (
                <div>
                  <div className="set-row">
                    <div className="lbl">
                      <div className="t">{t('settings.savedColors')}</div>
                      <div className="d">{t('settings.savedColorsDesc')}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                    {settings.customColors.map((c) => (
                      <div
                        key={c}
                        title={t('settings.colorClickToRemove', { color: c })}
                        onClick={() => set({ customColors: settings.customColors.filter((x) => x !== c) })}
                        style={{ width: 26, height: 26, borderRadius: 7, background: c, cursor: 'pointer', border: '1px solid var(--border)' }}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {tab === 'capture' && (
            <>
              <Row title={t('settings.afterCapture')} desc={t('settings.afterCaptureDesc')}>
                <select className="select" style={{ width: 180 }} value={settings.afterCapture} onChange={(e) => set({ afterCapture: e.target.value as Settings['afterCapture'] })}>
                  <option value="editor">{t('settings.afterCaptureEditor')}</option>
                  <option value="save">{t('settings.afterCaptureSave')}</option>
                  <option value="pin">{t('settings.afterCapturePin')}</option>
                </select>
              </Row>
              <Row title={t('settings.screenshotFormat')} desc={t('settings.screenshotFormatDesc')}>
                <select
                  className="select"
                  style={{ width: 180 }}
                  value={settings.screenshotFormat}
                  onChange={(e) => set({ screenshotFormat: e.target.value as Settings['screenshotFormat'] })}
                >
                  <option value="png">{t('settings.formatPng')}</option>
                  <option value="jpeg">{t('settings.formatJpeg')}</option>
                </select>
              </Row>
              {settings.screenshotFormat === 'jpeg' && (
                <Row title={t('settings.jpegQuality')} desc={t('settings.jpegQualityDesc')}>
                  <input
                    type="range"
                    min={40}
                    max={100}
                    step={5}
                    value={settings.jpegQuality}
                    onChange={(e) => set({ jpegQuality: Number(e.target.value) })}
                  />
                  <span className="small muted" style={{ marginLeft: 8 }}>{settings.jpegQuality}</span>
                </Row>
              )}
              <Row title={t('settings.recordingFormat')} desc={t('settings.recordingFormatDesc')}>
                <select
                  className="select"
                  style={{ width: 180 }}
                  value={settings.recordingFormat}
                  onChange={(e) => set({ recordingFormat: e.target.value as Settings['recordingFormat'] })}
                >
                  <option value="mp4">{t('settings.formatMp4')}</option>
                  <option value="webm">{t('settings.formatWebm')}</option>
                </select>
              </Row>
              <Row title={t('settings.copyToClipboard')} desc={t('settings.copyToClipboardDesc')}>
                <Toggle on={settings.copyToClipboardOnCapture} onChange={(v) => set({ copyToClipboardOnCapture: v })} />
              </Row>
              <div>
                <label className="field-label">{t('settings.namingPattern')}</label>
                <input className="input" value={settings.namingPattern} onChange={(e) => set({ namingPattern: e.target.value })} />
                <div className="small muted" style={{ marginTop: 6 }}>
                  {t('settings.namingTokens')} {'{project} {date} {time} {mode}'}
                </div>
              </div>
            </>
          )}

          {tab === 'hotkeys' && (
            <>
              <div className="small muted">{t('settings.hotkeysHint')}</div>
              {(
                [
                  ['region', 'settings.hotkeyRegion'],
                  ['window', 'settings.hotkeyWindow'],
                  ['fullscreen', 'settings.hotkeyFullscreen'],
                  ['delayed', 'settings.hotkeyDelayed'],
                  ['record', 'settings.hotkeyRecord']
                ] as const
              ).map(([k, labelKey]) => (
                <Row key={k} title={t(labelKey)}>
                  <input
                    className="input"
                    style={{ width: 200 }}
                    value={settings.hotkeys[k]}
                    onChange={(e) => setHotkey(k, e.target.value)}
                  />
                </Row>
              ))}
            </>
          )}

          {tab === 'ai' && (
            <>
              <Row title={t('settings.enableAi')} desc={t('settings.enableAiDesc')}>
                <Toggle on={settings.aiEnabled} onChange={(v) => set({ aiEnabled: v })} />
              </Row>
              <Row title={t('settings.provider')} desc={t('settings.providerDesc')}>
                <select
                  className="select"
                  style={{ width: 220 }}
                  value={settings.aiProvider}
                  onChange={(e) => {
                    const p = e.target.value as Settings['aiProvider']
                    if (p === 'openai') set({ aiProvider: p, aiModel: settings.aiModel.startsWith('claude') ? 'gpt-4o-mini' : settings.aiModel })
                    else set({ aiProvider: p, aiModel: settings.aiModel.startsWith('claude') ? settings.aiModel : 'claude-opus-4-8' })
                  }}
                >
                  <option value="anthropic">{t('settings.providerAnthropic')}</option>
                  <option value="openai">{t('settings.providerOpenai')}</option>
                </select>
              </Row>
              {settings.aiProvider === 'openai' && (
                <div>
                  <label className="field-label">{t('settings.baseUrl')}</label>
                  <input className="input" placeholder="https://api.openai.com/v1" value={settings.aiBaseUrl} onChange={(e) => set({ aiBaseUrl: e.target.value })} />
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                    {(
                      [
                        ['OpenAI', 'https://api.openai.com/v1'],
                        ['OpenRouter', 'https://openrouter.ai/api/v1'],
                        ['Ollama', 'http://localhost:11434/v1'],
                        ['LM Studio', 'http://localhost:1234/v1']
                      ] as const
                    ).map(([label, url]) => (
                      <button key={url} className="btn sm" onClick={() => set({ aiBaseUrl: url })}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <label className="field-label">{settings.aiProvider === 'openai' ? t('settings.apiKeyOptional') : t('settings.apiKeyAnthropic')}</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    className="input"
                    type="password"
                    placeholder={settings.hasApiKey ? t('settings.apiKeySavedPlaceholder') : settings.aiProvider === 'openai' ? t('settings.apiKeyOpenaiPlaceholder') : t('settings.apiKeyAnthropicPlaceholder')}
                    value={keyInput}
                    onChange={(e) => setKeyInput(e.target.value)}
                  />
                  <button
                    className="btn"
                    onClick={async () => {
                      await api.setApiKey(keyInput)
                      setKeyInput('')
                      setKeyStatus(t('settings.statusSaved'))
                    }}
                  >
                    {t('settings.save')}
                  </button>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
                  <button
                    className="btn sm"
                    onClick={async () => {
                      setKeyStatus(t('settings.statusTesting'))
                      const r = await api.testApiKey()
                      setKeyStatus(r.ok ? t('settings.statusWorks') : `✗ ${r.error ?? t('settings.statusFailed')}`)
                    }}
                  >
                    {t('settings.testConnection')}
                  </button>
                  {settings.hasApiKey && (
                    <button
                      className="btn sm danger"
                      onClick={() => {
                        api.clearApiKey()
                        setKeyStatus(t('settings.statusRemoved'))
                      }}
                    >
                      {t('settings.removeKey')}
                    </button>
                  )}
                  <span className="small muted">{keyStatus}</span>
                </div>
              </div>
              <Row title={t('settings.model')}>
                {settings.aiProvider === 'anthropic' ? (
                  <select className="select" style={{ width: 240 }} value={settings.aiModel} onChange={(e) => set({ aiModel: e.target.value })}>
                    {MODELS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {t(m.labelKey)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input className="input" style={{ width: 240 }} placeholder={t('settings.modelPlaceholder')} value={settings.aiModel} onChange={(e) => set({ aiModel: e.target.value })} />
                )}
              </Row>
              <div className="divider" />
              <Row title={t('settings.localOcr')} desc={t('settings.localOcrDesc')}>
                <Toggle on={settings.ocrEnabled} onChange={(v) => set({ ocrEnabled: v })} />
              </Row>
              <Row title={t('settings.autoName')}>
                <Toggle on={settings.aiAutoName} onChange={(v) => set({ aiAutoName: v })} />
              </Row>
              <Row title={t('settings.autoTag')}>
                <Toggle on={settings.aiAutoTag} onChange={(v) => set({ aiAutoTag: v })} />
              </Row>
              <Row title={t('settings.describeForSearch')}>
                <Toggle on={settings.aiAutoDescribe} onChange={(v) => set({ aiAutoDescribe: v })} />
              </Row>
              <Row title={t('settings.autoFile')} desc={t('settings.autoFileDesc')}>
                <Toggle on={settings.aiSuggestProject} onChange={(v) => set({ aiSuggestProject: v })} />
              </Row>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
