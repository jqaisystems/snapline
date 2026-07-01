import { globalShortcut } from 'electron'
import { getStore } from './store'
import { performCapture } from './captureFlow'
import { startRecording } from './recorder'
import { toast } from './broadcast'

export function registerHotkeys(): void {
  globalShortcut.unregisterAll()
  const { hotkeys } = getStore().getSettings()

  const bind = (accel: string, run: () => void): void => {
    if (!accel) return
    try {
      const ok = globalShortcut.register(accel, run)
      if (!ok) console.warn('[hotkeys] could not register', accel)
    } catch (err) {
      console.warn('[hotkeys] invalid accelerator', accel, err)
    }
  }

  bind(hotkeys.region, () => void performCapture({ mode: 'region' }))
  bind(hotkeys.window, () => void performCapture({ mode: 'window' }))
  bind(hotkeys.fullscreen, () => void performCapture({ mode: 'fullscreen' }))
  bind(hotkeys.delayed, () => {
    toast('Capturing full screen in 3s…')
    void performCapture({ mode: 'fullscreen', delayMs: 3000 })
  })
  bind(hotkeys.record, () => void startRecording('screen'))
}

export function unregisterHotkeys(): void {
  globalShortcut.unregisterAll()
}
