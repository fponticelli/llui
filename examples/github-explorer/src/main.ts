/**
 * Client entry point.
 * Hydrates server-rendered HTML when present, otherwise mounts fresh.
 */
import { mountApp } from '@llui/dom'
import {
  createAgentClient,
  agentConnect,
  agentConfirm,
  agentLog,
  agentAttention,
} from '@llui/agent/client'
import type { State, Msg } from './types'
import { appDef, initialState, setAgentClient } from './app'

const container = document.getElementById('app')!

const handle = mountApp(container, appDef)

// Agent client — browser only, created after mount so the handle exists
if (typeof window !== 'undefined') {
  const agentClient = createAgentClient<State, Msg>({
    handle,
    def: appDef as Parameters<typeof createAgentClient>[0]['def'],
    rootElement: container,
    slices: {
      getConnect: (s) => s.agent.connect,
      getConfirm: (s) => s.agent.confirm,
      wrapConnectMsg: (m) => ({
        type: 'agent',
        sub: 'connect',
        msg: m as agentConnect.AgentConnectMsg,
      }),
      wrapConfirmMsg: (m) => ({
        type: 'agent',
        sub: 'confirm',
        msg: m as agentConfirm.AgentConfirmMsg,
      }),
      wrapLogMsg: (m) => ({
        type: 'agent',
        sub: 'log',
        msg: m as agentLog.AgentLogMsg,
      }),
      wrapAttentionMsg: (m) => ({
        type: 'agent',
        sub: 'attention',
        msg: m as agentAttention.AgentAttentionMsg,
      }),
    },
  })
  setAgentClient(agentClient)
  agentClient.start()
}

// Suppress unused variable warning — initialState is exported for use by
// entry-server.ts but imported here to keep the module graph consistent.
void initialState
