import { div, h2, p, span, text } from '@llui/core'
import { useMachine, type ZagMachineConstructor, type ZagConnectFn } from '@llui/zag'

interface ProgressApi {
  getRootProps(): Record<string, unknown>
  getLabelProps(): Record<string, unknown>
  getTrackProps(): Record<string, unknown>
  getRangeProps(): Record<string, unknown>
}

export function progressPage(VM: ZagMachineConstructor, mod: { machine: unknown; connect: ZagConnectFn<ProgressApi> }): Node[] {
  const z = useMachine(VM, mod.machine, mod.connect, { id: 'pg', value: 65 })
  return [
    h2({ class: 'page-title' }, [text('Progress')]),
    p({ class: 'page-desc' }, [text('Determinate progress bar powered by @zag-js/progress. Proper ARIA role and value attributes.')]),
    div({ class: 'demo-box' }, [
      z.render('div', a => a.getRootProps(), [
        div({ class: 'progress-header' }, [
          z.render('label', a => a.getLabelProps(), [text('Uploading files...')]),
          span({}, [text('65%')]),
        ]),
        z.render('div', a => a.getTrackProps(), [
          z.render('div', a => a.getRangeProps()),
        ]),
      ]),
    ]),
  ]
}
