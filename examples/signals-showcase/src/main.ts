// Signals showcase — entry. Mounts each demo component with the signal mountApp.
import { mountApp } from '@llui/dom'
import { Counter } from './counter'
import { Todos } from './todos'
import { Editor } from './editor'

mountApp(document.getElementById('counter')!, Counter)
mountApp(document.getElementById('todos')!, Todos)
mountApp(document.getElementById('editor')!, Editor)
