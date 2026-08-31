import '@llui/components/styles/theme.css'

const app = document.querySelector<HTMLElement>('#app')
if (app === null) throw new Error('Missing #app')

app.innerHTML = [
  '<section>',
  '  <h1>Baseline CSS, no Tailwind</h1>',
  '  <button class="btn btn-primary" type="button">Continue</button>',
  '  <button class="btn btn-secondary" type="button" disabled>Unavailable</button>',
  '  <button data-scope="switch" data-part="root" type="button" aria-label="Theme">',
  '    <span data-scope="switch" data-part="track" data-state="checked">',
  '      <span data-scope="switch" data-part="thumb" data-state="checked"></span>',
  '    </span>',
  '  </button>',
  '</section>',
].join('\n')
