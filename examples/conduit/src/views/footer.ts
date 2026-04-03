import { footer, div, a, span, text } from '@llui/dom'

export function appFooter(): HTMLElement {
  return footer({}, [
    div({ class: 'container' }, [
      a({ class: 'logo-font', href: '#/' }, [text('conduit')]),
      span({ class: 'attribution' }, [
        text('An interactive learning project from '),
        a({ href: 'https://thinkster.io' }, [text('Thinkster')]),
        text('. Code & design licensed under MIT. Built with '),
        a({ href: 'https://github.com/fponticelli/llui' }, [text('LLui')]),
        text('.'),
      ]),
    ]),
  ])
}
