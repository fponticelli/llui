import { div, h2, p, span, label, text } from '@llui/core'
import { useMachine } from '@llui/zag'

type Props = Record<string, unknown>

export function progressPage(VM: unknown, mod: { machine: unknown; connect: unknown }): Node[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { api } = useMachine(VM as any, mod.machine, mod.connect as any, { id: 'pg', value: 65 })
  return [
    h2({ class: 'page-title' }, [text('Progress')]),
    p({ class: 'page-desc' }, [text('Determinate progress bar powered by @zag-js/progress. Proper ARIA role and value attributes.')]),
    div({ class: 'demo-box' }, [
      div(api.getRootProps() as Props, [
        div({ class: 'progress-header' }, [
          label(api.getLabelProps() as Props, [text('Uploading files...')]),
          span({}, [text('65%')]),
        ]),
        div(api.getTrackProps() as Props, [
          div(api.getRangeProps() as Props),
        ]),
      ]),
    ]),
  ]
}
