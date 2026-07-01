import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@ui': resolve(__dirname, 'src/renderer/src/ui')
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          library: resolve(__dirname, 'src/renderer/library.html'),
          overlay: resolve(__dirname, 'src/renderer/overlay.html'),
          editor: resolve(__dirname, 'src/renderer/editor.html'),
          pin: resolve(__dirname, 'src/renderer/pin.html'),
          scrollctl: resolve(__dirname, 'src/renderer/scrollctl.html'),
          recordctl: resolve(__dirname, 'src/renderer/recordctl.html')
        }
      }
    }
  }
})
