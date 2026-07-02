import React, { useEffect, useRef, useState } from 'react'
import { api } from '@ui/api'
import { Icon } from '@ui/icons'
import './recordctl.css'

// Floating control bar that also drives the recording. It pulls its config (source id, mic)
// from main, runs MediaRecorder on a desktop-capture stream, and on Stop hands the WebM +
// a poster frame back to main to be saved + indexed.
export default function App(): React.ReactElement {
  const [elapsed, setElapsed] = useState(0)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasMic, setHasMic] = useState(false)
  const [micOn, setMicOn] = useState(false)

  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const micTrackRef = useRef<MediaStreamTrack | null>(null)
  const posterRef = useRef<string | null>(null)
  const dimsRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 })
  const startedAtRef = useRef(0)
  const cancelledRef = useRef(false)
  const endedRef = useRef(false) // stop()/cancel() are single-shot; guards the finish-vs-cancel race
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    let disposed = false
    void (async () => {
      const cfg = await api.getRecordConfig()
      if (!cfg) {
        setError('No source')
        return
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: cfg.sourceId } }
        } as unknown as MediaStreamConstraints)
        if (disposed) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        const vtrack = stream.getVideoTracks()[0]
        const s = vtrack?.getSettings()
        if (s?.width && s?.height) dimsRef.current = { width: s.width, height: s.height }

        if (cfg.mic) {
          try {
            // Honour the user's chosen input device; fall back to the system default.
            const audioConstraint: MediaTrackConstraints | boolean = cfg.micDeviceId
              ? { deviceId: { exact: cfg.micDeviceId } }
              : true
            const micStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint })
            const mt = micStream.getAudioTracks()[0]
            if (mt) {
              stream.addTrack(mt)
              micTrackRef.current = mt
              setHasMic(true)
              setMicOn(true)
            } else {
              void api.toast('No microphone track available, recording video only')
            }
          } catch (err) {
            // Don't swallow: surface so the user knows and the error name reaches the main log.
            console.error('[recordctl] mic unavailable, recording video only:', err)
            void api.toast('Microphone unavailable, recording video only')
          }
        }

        await capturePoster(stream)

        const mimeType = pickMime()
        const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
        rec.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
        }
        rec.onstop = onStop
        recRef.current = rec
        rec.start(1000)
        vtrack?.addEventListener('ended', () => stop()) // source closed (e.g. window closed)
        startedAtRef.current = performance.now()
        timerRef.current = window.setInterval(() => setElapsed(performance.now() - startedAtRef.current), 200)
        setReady(true)
      } catch (err) {
        console.error('[recordctl] start failed', err)
        setError('Cannot record')
      }
    })()
    return () => {
      disposed = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function pickMime(): string | null {
    for (const o of ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']) {
      if (MediaRecorder.isTypeSupported(o)) return o
    }
    return null
  }

  function capturePoster(stream: MediaStream): Promise<void> {
    return new Promise((resolve) => {
      const v = document.createElement('video')
      v.muted = true
      v.srcObject = stream
      let done = false
      const finish = (): void => {
        if (done) return
        done = true
        v.srcObject = null
        resolve()
      }
      v.onloadeddata = () => {
        try {
          const w = v.videoWidth
          const h = v.videoHeight
          if (w && h) {
            dimsRef.current = { width: w, height: h }
            const scale = Math.min(1, 480 / w)
            const c = document.createElement('canvas')
            c.width = Math.round(w * scale)
            c.height = Math.round(h * scale)
            const ctx = c.getContext('2d')
            if (ctx) {
              ctx.drawImage(v, 0, 0, c.width, c.height)
              posterRef.current = c.toDataURL('image/png')
            }
          }
        } catch {
          /* ignore */
        }
        finish()
      }
      v.play().catch(() => finish())
      setTimeout(finish, 1500)
    })
  }

  function onStop(): void {
    if (timerRef.current) window.clearInterval(timerRef.current)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    if (cancelledRef.current) {
      void api.cancelRecording()
      return
    }
    const blob = new Blob(chunksRef.current, { type: 'video/webm' })
    const durationMs = Math.round(performance.now() - startedAtRef.current)
    void blob.arrayBuffer().then((buf) =>
      api.finishRecording({
        webm: buf,
        posterDataUrl: posterRef.current,
        width: dimsRef.current.width,
        height: dimsRef.current.height,
        durationMs
      })
    )
  }

  function stop(): void {
    if (endedRef.current) return // ignore double Stop / Stop-then-Cancel / source-ended races
    endedRef.current = true
    const rec = recRef.current
    if (rec && rec.state !== 'inactive') rec.stop()
    else {
      streamRef.current?.getTracks().forEach((t) => t.stop())
      void api.cancelRecording()
    }
  }
  function cancel(): void {
    cancelledRef.current = true
    stop()
  }
  function toggleMic(): void {
    const mt = micTrackRef.current
    if (!mt) return
    mt.enabled = !mt.enabled
    setMicOn(mt.enabled)
  }

  const secs = Math.floor(elapsed / 1000)
  const mm = String(Math.floor(secs / 60)).padStart(2, '0')
  const ss = String(secs % 60).padStart(2, '0')

  return (
    <div className="rc-root">
      <div className="rc-rec">
        <span className="rc-dot" />
        <span>{error ? error : ready ? `${mm}:${ss}` : 'Starting…'}</span>
      </div>
      <div className="rc-actions">
        {hasMic && (
          <button className="rc-btn ghost" onClick={toggleMic} title={micOn ? 'Mute microphone' : 'Unmute microphone'}>
            <Icon name={micOn ? 'mic' : 'micOff'} size={15} />
          </button>
        )}
        <button className="rc-btn ghost" onClick={cancel} title="Cancel">
          <Icon name="x" size={15} />
        </button>
        <button className="rc-btn primary" onClick={stop} title="Stop recording">
          <Icon name="stop" size={13} /> Stop
        </button>
      </div>
    </div>
  )
}
