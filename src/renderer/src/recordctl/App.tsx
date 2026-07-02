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
  const containerRef = useRef<'mp4' | 'webm'>('webm') // actual container MediaRecorder produced
  const audioCtxRef = useRef<AudioContext | null>(null) // mixer when recording mic + system together
  const keepAliveRef = useRef<AudioContext | null>(null) // silent render session that keeps Windows loopback delivering
  const rawAudioTracksRef = useRef<MediaStreamTrack[]>([]) // source tracks feeding the mix, to stop on teardown
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
        const wantSystem = cfg.audioSource === 'system' || cfg.audioSource === 'both'
        const wantMic = cfg.audioSource === 'mic' || cfg.audioSource === 'both'
        const videoConstraint = {
          mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: cfg.sourceId }
        }

        // Desktop video (native resolution via the precise source id).
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: videoConstraint
        } as unknown as MediaStreamConstraints)
        if (disposed) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        const vtrack = stream.getVideoTracks()[0]
        const s = vtrack?.getSettings()
        if (s?.width && s?.height) dimsRef.current = { width: s.width, height: s.height }

        // System ("background") audio: getDisplayMedia + the main-process loopback handler is the
        // only reliable way to capture Windows system sound. We keep only its audio track and drop
        // the video it also returns. Failing just records without system audio.
        let systemTrack: MediaStreamTrack | undefined
        if (wantSystem) {
          try {
            // Windows (WASAPI) loopback delivers permanent silence if the capture starts while
            // nothing is rendering audio on the device, and it never recovers once sound starts.
            // Keep our own silent render session open for the whole recording so the loopback
            // stream always has a pacing source. Zero-gain, so nothing is audible.
            const ka = new AudioContext()
            const kaOsc = ka.createOscillator()
            const kaGain = ka.createGain()
            kaGain.gain.value = 0
            kaOsc.connect(kaGain).connect(ka.destination)
            kaOsc.start()
            keepAliveRef.current = ka
            await ka.resume().catch(() => {})
            // Wait (bounded) until the context has actually rendered a quantum, i.e. the OS
            // audio session exists, before opening the loopback capture.
            const kaT0 = performance.now()
            while (ka.currentTime === 0 && performance.now() - kaT0 < 500) {
              await new Promise((r) => setTimeout(r, 25))
            }
            // Disable the voice DSP (noise suppression / auto-gain / echo cancellation): it is tuned
            // for speech and turns music/system audio muddy. Loopback should be captured raw.
            const sysStream = await navigator.mediaDevices.getDisplayMedia({
              video: true,
              audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
            })
            systemTrack = sysStream.getAudioTracks()[0]
            // Also clear any processing that survived, best-effort.
            try {
              await systemTrack?.applyConstraints({
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
              } as MediaTrackConstraints)
            } catch {
              /* not all constraints are settable post-hoc; ignore */
            }
            sysStream.getVideoTracks().forEach((t) => t.stop())
            if (!systemTrack) void api.toast('System audio unavailable on this PC')
          } catch (err) {
            console.error('[recordctl] system audio unavailable:', err)
            void api.toast('System audio unavailable, recording without it')
          }
        }

        // Microphone (separate device stream), if requested.
        let micTrack: MediaStreamTrack | undefined
        if (wantMic) {
          try {
            let micStream: MediaStream
            try {
              const audioConstraint: MediaTrackConstraints | boolean = cfg.micDeviceId
                ? { deviceId: { exact: cfg.micDeviceId } }
                : true
              micStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint })
            } catch (err) {
              // Saved device gone or stale (unplugged, id rotated): fall back to the system
              // default microphone rather than silently recording without one.
              if (!cfg.micDeviceId) throw err
              console.error('[recordctl] chosen mic unavailable, falling back to default:', err)
              micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
            }
            micTrack = micStream.getAudioTracks()[0]
            if (micTrack) {
              micTrackRef.current = micTrack
              setHasMic(true)
              setMicOn(true)
            } else {
              void api.toast('No microphone track available')
            }
          } catch (err) {
            console.error('[recordctl] mic unavailable:', err)
            void api.toast('Microphone unavailable')
          }
        }

        // MediaRecorder records a single audio track: use the one source directly, or mix mic +
        // system into one track via the Web Audio API when both are present.
        const audioSources = [systemTrack, micTrack].filter(Boolean) as MediaStreamTrack[]
        rawAudioTracksRef.current = audioSources
        stream.getAudioTracks().forEach((t) => stream.removeTrack(t))
        if (audioSources.length === 1) {
          stream.addTrack(audioSources[0])
        } else if (audioSources.length >= 2) {
          // Lock the mixer to 48 kHz (the loopback/mic native rate) to avoid resampling artifacts,
          // and attenuate each source so summing mic + system doesn't clip/distort.
          const ac = new AudioContext({ sampleRate: 48000 })
          audioCtxRef.current = ac
          const dest = ac.createMediaStreamDestination()
          for (const tr of audioSources) {
            const gain = ac.createGain()
            gain.gain.value = 0.85
            ac.createMediaStreamSource(new MediaStream([tr])).connect(gain).connect(dest)
          }
          stream.addTrack(dest.stream.getAudioTracks()[0])
        }

        await capturePoster(stream)

        const picked = pickMime(cfg.format)
        containerRef.current = picked.container
        // Explicit audio bitrate: the default for screen recording is low and garbles music
        // (Spotify/YouTube). 128 kbps keeps background audio clear.
        const recOpts: MediaRecorderOptions = { audioBitsPerSecond: 128000 }
        if (picked.mimeType) recOpts.mimeType = picked.mimeType
        const rec = new MediaRecorder(stream, recOpts)
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

  // Pick the best supported codec for the requested container. MP4 (H.264/AAC) is preferred for
  // compatibility but not supported on every build, so fall back to WebM. Returns the container
  // actually chosen so the file gets the right extension.
  function pickMime(preferred: 'mp4' | 'webm'): { mimeType: string | null; container: 'mp4' | 'webm' } {
    if (preferred === 'mp4') {
      for (const o of [
        'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
        'video/mp4;codecs=avc1,mp4a.40.2',
        'video/mp4;codecs=avc1',
        'video/mp4'
      ]) {
        if (MediaRecorder.isTypeSupported(o)) return { mimeType: o, container: 'mp4' }
      }
      // MP4 unsupported on this build: fall back to WebM below.
    }
    for (const o of ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']) {
      if (MediaRecorder.isTypeSupported(o)) return { mimeType: o, container: 'webm' }
    }
    return { mimeType: null, container: 'webm' }
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

  // Stop the recording stream plus any raw mic/system source tracks, and close the mixer.
  function teardownStreams(): void {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    rawAudioTracksRef.current.forEach((t) => t.stop())
    rawAudioTracksRef.current = []
    audioCtxRef.current?.close().catch(() => {})
    audioCtxRef.current = null
    keepAliveRef.current?.close().catch(() => {})
    keepAliveRef.current = null
  }

  function onStop(): void {
    if (timerRef.current) window.clearInterval(timerRef.current)
    teardownStreams()
    if (cancelledRef.current) {
      void api.cancelRecording()
      return
    }
    const container = containerRef.current
    const blob = new Blob(chunksRef.current, { type: container === 'mp4' ? 'video/mp4' : 'video/webm' })
    const durationMs = Math.round(performance.now() - startedAtRef.current)
    void blob.arrayBuffer().then((buf) =>
      api.finishRecording({
        webm: buf,
        posterDataUrl: posterRef.current,
        width: dimsRef.current.width,
        height: dimsRef.current.height,
        durationMs,
        ext: container
      })
    )
  }

  function stop(): void {
    if (endedRef.current) return // ignore double Stop / Stop-then-Cancel / source-ended races
    endedRef.current = true
    const rec = recRef.current
    if (rec && rec.state !== 'inactive') rec.stop()
    else {
      teardownStreams()
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
