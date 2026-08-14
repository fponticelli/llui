import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  init,
  update,
  connect,
  totalSize,
  acceptToString,
  fileMatchesAccept,
  validateFiles,
  trackFile,
  trackFiles,
  getFile,
  releaseFile,
  releaseDropped,
  trackedFileCount,
} from '../../src/components/file-upload'
import type { FileMeta, FileUploadMsg, FileUploadState } from '../../src/components/file-upload'
import { pathHandle, component, mountApp, div } from '@llui/dom'
import { rootSignal, signalOf, read } from '../_signal'

function makeFile(name: string, size: number): File {
  return new File(['x'.repeat(size)], name, { type: 'text/plain' })
}

/** A tracked file: the metadata that lives in State, with the handle registered. */
function makeMeta(name: string, size: number): FileMeta {
  return trackFile(makeFile(name, size))
}

describe('file-upload reducer', () => {
  it('initializes empty', () => {
    expect(init()).toMatchObject({ files: [], multiple: false, dragging: false })
  })

  it('addFiles with single mode replaces existing', () => {
    const s0 = init({ multiple: false, files: [makeMeta('a.txt', 10)] })
    const [s] = update(s0, { type: 'addFiles', files: [makeMeta('b.txt', 20)] })
    expect(s.files.map((f) => f.name)).toEqual(['b.txt'])
  })

  it('addFiles with multi mode appends', () => {
    const s0 = init({ multiple: true, files: [makeMeta('a.txt', 10)] })
    const [s] = update(s0, { type: 'addFiles', files: [makeMeta('b.txt', 20)] })
    expect(s.files.map((f) => f.name)).toEqual(['a.txt', 'b.txt'])
  })

  it('maxFiles limits the selection', () => {
    const s0 = init({ multiple: true, maxFiles: 2 })
    const [s] = update(s0, {
      type: 'addFiles',
      files: [makeMeta('a', 1), makeMeta('b', 1), makeMeta('c', 1)],
    })
    expect(s.files).toHaveLength(2)
  })

  it('maxSize rejects oversized files', () => {
    const s0 = init({ multiple: true, maxSize: 50 })
    const [s] = update(s0, {
      type: 'addFiles',
      files: [makeMeta('small', 20), makeMeta('big', 100)],
    })
    expect(s.files.map((f) => f.name)).toEqual(['small'])
  })

  it('removeFile by index', () => {
    const s0 = init({ multiple: true, files: [makeMeta('a', 1), makeMeta('b', 1)] })
    const [s] = update(s0, { type: 'removeFile', index: 0 })
    expect(s.files.map((f) => f.name)).toEqual(['b'])
  })

  it('clear empties files', () => {
    const s0 = init({ files: [makeMeta('a', 1)] })
    const [s] = update(s0, { type: 'clear' })
    expect(s.files).toEqual([])
  })

  it('dragEnter/drop toggle dragging', () => {
    const [s1] = update(init(), { type: 'dragEnter' })
    expect(s1.dragging).toBe(true)
    const [s2] = update(s1, { type: 'drop' })
    expect(s2.dragging).toBe(false)
  })
})

describe('totalSize', () => {
  it('sums file sizes', () => {
    const s = init({ multiple: true, files: [makeMeta('a', 100), makeMeta('b', 200)] })
    expect(totalSize(s)).toBe(300)
  })
})

describe('file-upload.connect', () => {
  it('hiddenInput has id from options', () => {
    const p = connect(rootSignal(), vi.fn(), { id: 'up1' })
    expect(p.hiddenInput.id).toBe('up1:input')
    expect(p.label.for).toBe('up1:input')
  })

  it('onDrop sends drop + addFiles', () => {
    const send = vi.fn()
    const pc = connect(signalOf(init()), send, { id: 'x' })
    const ev = {
      preventDefault: vi.fn(),
      dataTransfer: { files: [] as File[] },
    } as unknown as DragEvent
    pc.dropzone.onDrop(ev)
    expect(send).toHaveBeenNthCalledWith(1, { type: 'drop' })
    expect(send).toHaveBeenNthCalledWith(2, { type: 'addFiles', files: [] })
  })

  it('clearTrigger sends clear', () => {
    const send = vi.fn()
    const pc = connect(signalOf(init()), send, { id: 'x' })
    pc.clearTrigger.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'clear' })
  })
})

describe('validateFiles', () => {
  it('records TOO_LARGE errors', () => {
    const s = init({ maxSize: 50 })
    const { accepted, rejected } = validateFiles([makeMeta('big', 100)], s, 0)
    expect(accepted).toHaveLength(0)
    expect(rejected[0]!.errors).toContainEqual({ code: 'TOO_LARGE', max: 50 })
  })

  it('records TOO_SMALL errors', () => {
    const s = init({ minFileSize: 50 })
    const { accepted, rejected } = validateFiles([makeMeta('tiny', 10)], s, 0)
    expect(accepted).toHaveLength(0)
    expect(rejected[0]!.errors).toContainEqual({ code: 'TOO_SMALL', min: 50 })
  })

  it('records TOO_MANY when maxFiles exceeded', () => {
    const s = init({ multiple: true, maxFiles: 2 })
    const { accepted, rejected } = validateFiles(
      [makeMeta('a', 1), makeMeta('b', 1), makeMeta('c', 1)],
      s,
      0,
    )
    expect(accepted.map((f) => f.name)).toEqual(['a', 'b'])
    expect(rejected[0]!.errors).toContainEqual({ code: 'TOO_MANY', max: 2 })
  })

  it('records INVALID_TYPE against MIME-object accept', () => {
    const s = init({ accept: { 'image/*': ['.png'] } })
    const { accepted, rejected } = validateFiles([makeMeta('doc.txt', 10)], s, 0)
    expect(accepted).toHaveLength(0)
    expect(rejected[0]!.errors).toContainEqual({ code: 'INVALID_TYPE' })
  })

  it('string accept is permissive (browser-side filter only)', () => {
    const s = init({ accept: 'image/*' })
    const { accepted } = validateFiles([makeMeta('doc.txt', 10)], s, 0)
    expect(accepted).toHaveLength(1)
  })
})

describe('acceptToString', () => {
  it('passes strings through', () => {
    expect(acceptToString('image/png,.jpg')).toBe('image/png,.jpg')
  })

  it('flattens MIME-object into comma-joined string', () => {
    const r = acceptToString({ 'image/*': ['.png', '.jpg'], 'application/pdf': [] })
    // Order: [mime, ...exts] per key, all joined
    expect(r.split(',').sort()).toEqual(['.jpg', '.png', 'application/pdf', 'image/*'].sort())
  })
})

describe('fileMatchesAccept', () => {
  const png = new File([], 'pic.png', { type: 'image/png' })
  const pdf = new File([], 'doc.pdf', { type: 'application/pdf' })
  const txt = new File([], 'note.txt', { type: 'text/plain' })

  it('matches MIME wildcards', () => {
    expect(fileMatchesAccept(png, { 'image/*': [] })).toBe(true)
    expect(fileMatchesAccept(pdf, { 'image/*': [] })).toBe(false)
  })

  it('matches extensions', () => {
    expect(fileMatchesAccept(pdf, { 'image/*': ['.pdf'] })).toBe(true)
    expect(fileMatchesAccept(txt, { 'image/*': ['.pdf'] })).toBe(false)
  })

  it('empty accept matches everything', () => {
    expect(fileMatchesAccept(txt, {})).toBe(true)
    expect(fileMatchesAccept(png, '')).toBe(true)
  })
})

describe('rejected files', () => {
  it('addFiles populates rejectedFiles alongside accepted', () => {
    const s0 = init({ multiple: true, maxSize: 50 })
    const [s] = update(s0, {
      type: 'addFiles',
      files: [makeMeta('ok', 10), makeMeta('toobig', 100)],
    })
    expect(s.files.map((f) => f.name)).toEqual(['ok'])
    expect(s.rejectedFiles[0]!.file.name).toBe('toobig')
  })

  it('clearRejected leaves files alone', () => {
    const s0 = init({ multiple: true, maxSize: 50 })
    const [s1] = update(s0, {
      type: 'addFiles',
      files: [makeMeta('ok', 10), makeMeta('big', 100)],
    })
    const [s2] = update(s1, { type: 'clearRejected' })
    expect(s2.rejectedFiles).toEqual([])
    expect(s2.files.map((f) => f.name)).toEqual(['ok'])
  })

  it('removeRejected by index', () => {
    const s0 = init({ multiple: true, maxSize: 5 })
    const [s1] = update(s0, {
      type: 'addFiles',
      files: [makeMeta('a', 100), makeMeta('b', 100)],
    })
    const [s2] = update(s1, { type: 'removeRejected', index: 0 })
    expect(s2.rejectedFiles.map((r) => r.file.name)).toEqual(['b'])
  })
})

describe('readonly + invalid', () => {
  it('readonly blocks addFiles and setFiles', () => {
    const s0 = init({ readonly: true })
    const [s1] = update(s0, { type: 'addFiles', files: [makeMeta('a', 1)] })
    expect(s1.files).toEqual([])
    const [s2] = update(s0, { type: 'setFiles', files: [makeMeta('b', 1)] })
    expect(s2.files).toEqual([])
  })

  it('setInvalid toggles state.invalid', () => {
    const [s1] = update(init(), { type: 'setInvalid', invalid: true })
    expect(s1.invalid).toBe(true)
  })
})

describe('connect: new parts + attrs', () => {
  it('hiddenInput forwards required + aria-invalid', () => {
    const p = connect(rootSignal(), vi.fn(), { id: 'x' })
    expect(read(p.hiddenInput.required, init({ required: true }))).toBe(true)
    expect(read(p.hiddenInput['aria-invalid'], init({ invalid: true }))).toBe('true')
    expect(read(p.hiddenInput['aria-invalid'], init())).toBeUndefined()
  })

  it('root exposes data-invalid + data-readonly', () => {
    const p = connect(rootSignal(), vi.fn(), { id: 'x' })
    expect(read(p.root['data-invalid'], init({ invalid: true }))).toBe('')
    expect(read(p.root['data-readonly'], init({ readonly: true }))).toBe('')
  })

  it('capture + directory options set hidden input attrs', () => {
    const p1 = connect(rootSignal(), vi.fn(), { id: 'x', capture: 'environment' })
    expect(p1.hiddenInput.capture).toBe('environment')

    const p2 = connect(rootSignal(), vi.fn(), { id: 'x', directory: true })
    expect(p2.hiddenInput.webkitdirectory).toBe('')
  })

  it('custom validate adds to rejectedFiles via the pipeline', async () => {
    // A live reducer behind the spy: a `send` that drops the message on the
    // floor is indistinguishable from a disabled gate, and connect now
    // (correctly) frees the handles of a message that never reached State.
    let state = init({ multiple: true })
    const send = vi.fn((m: FileUploadMsg) => {
      ;[state] = update(state, m)
    })
    const pc = connect(
      pathHandle<FileUploadState>(() => state, ''),
      send,
      {
        id: 'x',
        validate: (file) =>
          file.name.endsWith('.bad') ? [{ code: 'CUSTOM', message: 'banned name' }] : null,
      },
    )
    const input = document.createElement('input')
    input.type = 'file'
    const ok = makeFile('ok.txt', 10)
    const bad = makeFile('oops.bad', 10)
    Object.defineProperty(input, 'files', { value: [ok, bad] })
    pc.hiddenInput.onChange({ target: input } as unknown as Event)
    // Pipeline runs async via Promise.then — wait for microtasks.
    await Promise.resolve()
    await Promise.resolve()
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'addFiles',
        files: [expect.objectContaining({ name: 'ok.txt', size: ok.size })],
        customRejected: [
          {
            file: expect.objectContaining({ name: 'oops.bad', size: bad.size }),
            errors: [{ code: 'CUSTOM', message: 'banned name' }],
          },
        ],
      }),
    )
    // The live handles stay reachable out of band, keyed by the metadata id.
    const dispatched = send.mock.calls[0]![0] as { files: FileMeta[] }
    expect(getFile(dispatched.files[0]!)).toBe(ok)
  })

  it('transformFiles runs before validation', async () => {
    const send = vi.fn()
    const pc = connect(signalOf(init()), send, {
      id: 'x',
      transformFiles: (files) =>
        files.map((f) => new File([f], f.name.toUpperCase(), { type: f.type })),
    })
    const input = document.createElement('input')
    Object.defineProperty(input, 'files', { value: [makeFile('a.txt', 5)] })
    pc.hiddenInput.onChange({ target: input } as unknown as Event)
    await Promise.resolve()
    await Promise.resolve()
    const call = send.mock.calls[0]![0]
    expect(call.files[0].name).toBe('A.TXT')
  })

  it('no validate/transform: dispatches addFiles synchronously without customRejected', () => {
    const send = vi.fn()
    const pc = connect(signalOf(init()), send, { id: 'x' })
    const input = document.createElement('input')
    Object.defineProperty(input, 'files', { value: [makeFile('a.txt', 5)] })
    pc.hiddenInput.onChange({ target: input } as unknown as Event)
    // Synchronous path — no await needed
    expect(send).toHaveBeenCalledWith({
      type: 'addFiles',
      files: [expect.objectContaining({ name: 'a.txt', size: 5 })],
    })
    expect(send.mock.calls[0]![0].customRejected).toBeUndefined()
  })

  it('itemDeleteTrigger is a zag-aligned alias for removeTrigger', () => {
    const send = vi.fn()
    const p = connect(signalOf(init()), send, { id: 'x' })
    p.item(2).itemDeleteTrigger.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'removeFile', index: 2 })
  })
})

// State must be JSON-serializable (CLAUDE.md). A live `File` in State came back
// as `{}` through a round-trip, so `totalSize` went NaN and every name was lost
// (#119). The handles now live in a module-scoped registry keyed by `FileMeta.id`.
describe('file-upload state is JSON-serializable', () => {
  it('round-trips without change', () => {
    const s0 = init({ multiple: true, maxSize: 50, files: [makeMeta('a.txt', 10)] })
    const [s1] = update(s0, {
      type: 'addFiles',
      files: [makeMeta('b.txt', 20), makeMeta('big.txt', 100)],
    })
    const restored = JSON.parse(JSON.stringify(s1)) as FileUploadState
    expect(restored).toEqual(s1)
  })

  it('totalSize and update() still work on a restored state', () => {
    const s0 = init({ multiple: true, files: [makeMeta('a.txt', 10), makeMeta('b.txt', 20)] })
    const restored = JSON.parse(JSON.stringify(s0)) as FileUploadState
    expect(totalSize(restored)).toBe(30)
    const [s1] = update(restored, { type: 'removeFile', index: 0 })
    expect(s1.files.map((f) => f.name)).toEqual(['b.txt'])
  })

  it('the live handle is reachable through the registry, not through State', () => {
    const file = makeFile('a.txt', 10)
    const meta = trackFile(file)
    expect(getFile(meta)).toBe(file)
    expect(getFile(meta.id)).toBe(file)
    expect(Object.values(meta).every((v) => typeof v === 'string' || typeof v === 'number')).toBe(
      true,
    )
    releaseFile(meta)
    expect(getFile(meta)).toBeUndefined()
  })

  it('releaseDropped frees exactly the handles a transition dropped', () => {
    const keep = makeMeta('keep.txt', 1)
    const dropped = makeMeta('drop.txt', 1)
    const s0 = init({ multiple: true, files: [keep, dropped] })
    const [s1] = update(s0, { type: 'removeFile', index: 1 })
    releaseDropped(s0, s1)
    expect(getFile(keep)).toBeDefined()
    expect(getFile(dropped)).toBeUndefined()
  })
})

describe('single-file mode', () => {
  it('addFiles rejects the 2nd and later files with a reason', () => {
    const s0 = init({ multiple: false })
    const [s] = update(s0, {
      type: 'addFiles',
      files: [makeMeta('a', 1), makeMeta('b', 1), makeMeta('c', 1)],
    })
    expect(s.files.map((f) => f.name)).toEqual(['a'])
    expect(s.rejectedFiles.map((r) => r.file.name)).toEqual(['b', 'c'])
    expect(s.rejectedFiles[0]!.errors).toContainEqual({ code: 'TOO_MANY', max: 1 })
  })

  it('setFiles rejects the 2nd and later files too', () => {
    const s0 = init({ multiple: false })
    const [s] = update(s0, { type: 'setFiles', files: [makeMeta('a', 1), makeMeta('b', 1)] })
    expect(s.files.map((f) => f.name)).toEqual(['a'])
    expect(s.rejectedFiles.map((r) => r.file.name)).toEqual(['b'])
  })
})

describe('drag depth', () => {
  it('stays dragging while the pointer moves over a child', () => {
    // Real HTML DnD order: dragenter@child fires BEFORE dragleave@parent, and
    // both bubble to the dropzone handler. Without a depth counter the leave
    // clears the highlight while the pointer is still inside (#119).
    const [s1] = update(init(), { type: 'dragEnter' })
    const [s2] = update(s1, { type: 'dragEnter' })
    const [s3] = update(s2, { type: 'dragLeave' })
    expect(s3.dragging).toBe(true)
    const [s4] = update(s3, { type: 'dragLeave' })
    expect(s4.dragging).toBe(false)
  })

  it('drop resets the depth even when enters are unbalanced', () => {
    const [s1] = update(init(), { type: 'dragEnter' })
    const [s2] = update(s1, { type: 'dragEnter' })
    const [s3] = update(s2, { type: 'drop' })
    expect(s3.dragging).toBe(false)
    const [s4] = update(s3, { type: 'dragLeave' })
    expect(s4.dragging).toBe(false)
  })
})

describe('connect releases dropped handles', () => {
  it('removeTrigger releases only the removed file handle', () => {
    const keep = makeMeta('keep.txt', 1)
    const gone = makeMeta('gone.txt', 1)
    let state = init({ multiple: true, files: [keep, gone] })
    // A live handle over the reducer: peek() sees each new state, as it does
    // under a real mount — that is what lets connect diff before/after a send.
    const signal = pathHandle<FileUploadState>(() => state, '')
    const p = connect(
      signal,
      (m) => {
        ;[state] = update(state, m)
      },
      { id: 'x' },
    )
    p.item(1).removeTrigger.onClick(new MouseEvent('click'))
    expect(state.files.map((f) => f.name)).toEqual(['keep.txt'])
    expect(getFile(keep)).toBeDefined()
    expect(getFile(gone)).toBeUndefined()
  })

  it('clearTrigger releases every handle it dropped', () => {
    const a = makeMeta('a.txt', 1)
    const b = makeMeta('b.txt', 1)
    let state = init({ multiple: true, files: [a, b] })
    const signal = pathHandle<FileUploadState>(() => state, '')
    const p = connect(
      signal,
      (m) => {
        ;[state] = update(state, m)
      },
      { id: 'x' },
    )
    p.clearTrigger.onClick(new MouseEvent('click'))
    expect(state.files).toEqual([])
    expect(getFile(a)).toBeUndefined()
    expect(getFile(b)).toBeUndefined()
  })
})

// A gated message never reaches State, so `releaseDropped(prev, next)` — which
// can only free ids referenced by `prev` — cannot see the handles it carried.
// They were minted BEFORE the send and land in NEITHER state, so they stayed in
// the registry forever: two live `File` objects per drop on a disabled dropzone.
// `onDrop`/`dispatchAdd` carry no disabled/readonly guard, so this is the
// component's own path (#138 review, blocking 1).
describe('connect releases handles a gate swallowed', () => {
  /** A `drop` carrying files. jsdom has no `DataTransfer`, and the handler reads
   * exactly one field, so the event carries exactly that field. */
  function dropEvent(files: readonly File[]): DragEvent {
    const ev = new MouseEvent('drop')
    Object.defineProperty(ev, 'dataTransfer', { value: { files } })
    return ev as DragEvent
  }

  function live(state: FileUploadState): {
    parts: ReturnType<typeof connect>
    read: () => FileUploadState
  } {
    let current = state
    const parts = connect(
      pathHandle<FileUploadState>(() => current, ''),
      (m) => {
        ;[current] = update(current, m)
      },
      { id: 'x' },
    )
    return { parts, read: () => current }
  }

  it('a drop on a DISABLED uploader leaves nothing in the registry', () => {
    const before = trackedFileCount()
    const { parts, read } = live(init({ disabled: true, multiple: true }))
    parts.dropzone.onDrop(dropEvent([makeFile('a.txt', 1), makeFile('b.txt', 1)]))
    expect(read().files).toEqual([])
    expect(trackedFileCount()).toBe(before)
  })

  it('a drop on a READONLY uploader leaves nothing in the registry', () => {
    const before = trackedFileCount()
    const { parts, read } = live(init({ readonly: true, multiple: true }))
    parts.dropzone.onDrop(dropEvent([makeFile('c.txt', 1)]))
    expect(read().files).toEqual([])
    expect(trackedFileCount()).toBe(before)
  })

  it('a rejected file stays tracked — it is still in State, under rejectedFiles', () => {
    const before = trackedFileCount()
    const { parts, read } = live(init({ multiple: true, maxSize: 1 }))
    parts.dropzone.onDrop(dropEvent([makeFile('big.txt', 50)]))
    expect(read().files).toEqual([])
    expect(read().rejectedFiles).toHaveLength(1)
    expect(trackedFileCount()).toBe(before + 1)
    expect(getFile(read().rejectedFiles[0]!.file)).toBeDefined()
  })

  it('single-select keeps only the accepted file of a multi-file drop', () => {
    const before = trackedFileCount()
    const { parts, read } = live(init({ multiple: false }))
    parts.dropzone.onDrop(dropEvent([makeFile('a.txt', 1), makeFile('b.txt', 1)]))
    // 1 accepted + 1 rejected (TOO_MANY) — both are in State, both stay tracked.
    expect(read().files).toHaveLength(1)
    expect(read().rejectedFiles).toHaveLength(1)
    expect(trackedFileCount()).toBe(before + 2)
  })
})

// Nothing released at unmount: `connect` had no teardown, so every handle the
// State still referenced outlived the component. An SPA that mounts and
// unmounts an uploader grew without bound, holding the blobs alive
// (#138 review, blocking 2).
describe('connect releases its handles at unmount', () => {
  let container: HTMLElement

  beforeEach(() => {
    document.body.innerHTML = ''
    container = document.createElement('div')
    document.body.appendChild(container)
  })
  afterEach(() => {
    document.body.innerHTML = ''
  })

  type S = { up: FileUploadState }

  function mountUploader(files: FileMeta[]): ReturnType<typeof mountApp> {
    const def = component<S, FileUploadMsg, never>({
      name: 'Up',
      init: () => [{ up: init({ multiple: true, files }) }, []],
      update: (s, m) => [{ up: update(s.up, m)[0] }, []],
      view: ({ state, send }) => {
        const parts = connect(state.at('up'), send, { id: 'u' })
        return [div({ ...parts.root }, [div({ ...parts.dropzone })])]
      },
    })
    return mountApp(container, def)
  }

  it('disposing the mount frees every handle its State referenced', () => {
    const a = makeMeta('a.txt', 1)
    const b = makeMeta('b.txt', 1)
    const before = trackedFileCount()
    const app = mountUploader([a, b])
    expect(getFile(a)).toBeDefined()
    app.dispose()
    expect(getFile(a)).toBeUndefined()
    expect(getFile(b)).toBeUndefined()
    expect(trackedFileCount()).toBe(before - 2)
  })

  it('releases what State holds AT unmount, not what it held at mount', () => {
    const a = makeMeta('a.txt', 1)
    const b = makeMeta('b.txt', 1)
    const app = mountUploader([a, b])
    const added = makeMeta('c.txt', 1)
    app.send({ type: 'addFiles', files: [added] })
    const before = trackedFileCount()
    app.dispose()
    expect(trackedFileCount()).toBe(before - 3)
    expect(getFile(added)).toBeUndefined()
  })

  it('connect outside a build context registers no teardown and does not throw', () => {
    const meta = makeMeta('solo.txt', 1)
    const state = init({ files: [meta] })
    expect(() => connect(signalOf(state), vi.fn(), { id: 'x' })).not.toThrow()
    expect(getFile(meta)).toBeDefined()
  })
})

describe('trackFiles', () => {
  it('registers every file and preserves order', () => {
    const files = [makeFile('a.txt', 1), makeFile('b.txt', 2)]
    const metas = trackFiles(files)
    expect(metas.map((m) => m.name)).toEqual(['a.txt', 'b.txt'])
    expect(metas.map((m) => getFile(m))).toEqual(files)
  })
})
