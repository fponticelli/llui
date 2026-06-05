// Markdown showcase — entry point.
import { mountApp } from '@llui/dom'
import '@llui/markdown/styles/theme.css'
import '@llui/markdown/styles/theme-dark.css'
import './styles.css'
import { App } from './app.js'

mountApp(document.getElementById('app')!, App)
