// Signals showcase — entry. Mounts each demo component with the signal mountApp.
import { mountApp } from '@llui/dom/signals'
import { Counter } from './counter'
import { Todos } from './todos'

mountApp(document.getElementById('counter')!, Counter)
mountApp(document.getElementById('todos')!, Todos)
