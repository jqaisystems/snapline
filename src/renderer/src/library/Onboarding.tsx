import React, { useState } from 'react'
import { api } from '@ui/api'
import { Icon } from '@ui/icons'
import { t } from '@ui/i18n'

const FEATURES = [
  { icon: 'folder', titleKey: 'onboarding.featProjectTitle', descKey: 'onboarding.featProjectDesc' },
  { icon: 'sparkles', titleKey: 'onboarding.featAiTitle', descKey: 'onboarding.featAiDesc' },
  { icon: 'shield', titleKey: 'onboarding.featRedactTitle', descKey: 'onboarding.featRedactDesc' },
  { icon: 'wand', titleKey: 'onboarding.featBeautifyTitle', descKey: 'onboarding.featBeautifyDesc' }
]

export default function Onboarding(): React.ReactElement {
  const [path, setPath] = useState<string>('')
  const [busy, setBusy] = useState(false)

  async function choose(): Promise<void> {
    const p = await api.chooseStorageRoot()
    if (p) setPath(p)
  }
  async function finish(): Promise<void> {
    if (!path) return
    setBusy(true)
    await api.completeOnboarding({ storageRoot: path })
  }

  return (
    <div className="onb">
      <div className="onb-card">
        <div className="onb-logo">
          <Icon name="region" size={32} />
        </div>
        <h1>{t('onboarding.welcome')}</h1>
        <p>{t('onboarding.intro')}</p>

        <div className="onb-path">
          <input className="input" placeholder={t('onboarding.noFolder')} value={path} readOnly />
          <button className="btn" onClick={choose}>
            <Icon name="folder" size={16} /> {t('onboarding.browse')}
          </button>
        </div>

        <div className="onb-feats">
          {FEATURES.map((f) => (
            <div className="onb-feat" key={f.titleKey}>
              <span className="fi">
                <Icon name={f.icon} size={18} />
              </span>
              <span className="ft">
                <b>{t(f.titleKey)}</b>
                {t(f.descKey)}
              </span>
            </div>
          ))}
        </div>

        <button className="btn primary" style={{ width: '100%', justifyContent: 'center' }} disabled={!path || busy} onClick={finish}>
          {busy ? t('onboarding.settingUp') : t('onboarding.start')}
        </button>
        <p className="small muted" style={{ marginTop: 14 }}>
          {t('onboarding.privacy')}
        </p>
      </div>
    </div>
  )
}
