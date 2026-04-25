// Consumer file — declares a State and feeds the externally-declared
// `Action` (renamed `Cmd` here on import) to `component<S, M, E>()`.
// Typed-lint scans this file as part of the program, finds the
// `component<>()` call, resolves the M arg's symbol, and adds it to
// the project-wide Msg-arg symbol set. When the rule then runs on
// `external-msg.ts`, the type alias `Action`'s symbol matches.
import { component } from '@llui/dom'
import { Action as Cmd } from './external-msg'

type State = { x: number }

declare const placeholder: unknown
export const App = component<State, Cmd, never>(placeholder as never)
