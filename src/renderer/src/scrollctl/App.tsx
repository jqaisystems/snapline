import React, { useEffect, useState } from 'react'
import type { ScrollStatus } from '@shared/types'
import { api } from '@ui/api'
import { Icon } from '@ui/icons'
import './scrollctl.css'

export default function App(): React.ReactElement {
  const [status, setStatus] = useState<ScrollStatus>({ frames: 0, height: 0 })

  useEffect(() => api.onScrollStatus(setStatus), [])

  return (
    <div className="sc-root">
      <div className="sc-rec">
        <span className="sc-dot" />
        <span>Scroll the area slowly</span>
      </div>
      <div className="sc-meta">
        {status.height}px · {status.frames} frames
      </div>
      <div className="sc-actions">
        <button className="sc-btn ghost" onClick={() => api.scrollCancel()} title="Cancel">
          <Icon name="x" size={15} />
        </button>
        <button className="sc-btn primary" onClick={() => api.scrollDone()}>
          <Icon name="check" size={15} /> Done
        </button>
      </div>
    </div>
  )
}
