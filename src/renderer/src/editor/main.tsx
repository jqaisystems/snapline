import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { initThemeFromCache } from '@ui/api'
import { initLocaleFromCache } from '@ui/i18n'
import '@ui/global.css'

initThemeFromCache()
initLocaleFromCache()
createRoot(document.getElementById('root')!).render(<App />)
