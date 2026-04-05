import { describe, it, expect, vi } from 'vitest'
import {
  init,
  update,
  connect,
  totalSize,
  acceptToString,
  fileMatchesAccept,
  validateFiles,
} from '../../src/components/file-upload'
import type { FileUploadState } from '../../src/components/file-upload'

type Ctx = { u: FileUploadState }

function makeFile(name: string, size: number): File {
  return new File(['x'.repeat(size)], name, { type: 'text/plain' })
}

describe('file-upload reducer', () => {
  it('initializes empty', () => {
    expect(init()).toMatchObject({ files: [], multiple: false, dragging: false })
  })

  it('addFiles with single mode replaces existing', () => {
    const s0 = init({ multiple: false, files: [makeFile('a.txt', 10)] })
    const [s] = update(s0, { type: 'addFiles', files: [makeFile('b.txt', 20)] })
    expect(s.files.map((f) => f.name)).toEqual(['b.txt'])
  })

  it('addFiles with multi mode appends', () => {
    const s0 = init({ multiple: true, files: [makeFile('a.txt', 10)] })
    const [s] = update(s0, { type: 'addFiles', files: [makeFile('b.txt', 20)] })
    expect(s.files.map((f) => f.name)).toEqual(['a.txt', 'b.txt'])
  })

  it('maxFiles limits the selection', () => {
    const s0 = init({ multiple: true, maxFiles: 2 })
    const [s] = update(s0, {
      type: 'addFiles',
      files: [makeFile('a', 1), makeFile('b', 1), makeFile('c', 1)],
    })
    expect(s.files).toHaveLength(2)
  })

  it('maxSize rejects oversized files', () => {
    const s0 = init({ multiple: true, maxSize: 50 })
    const [s] = update(s0, {
      type: 'addFiles',
      files: [makeFile('small', 20), makeFile('big', 100)],
    })
    expect(s.files.map((f) => f.name)).toEqual(['small'])
  })

  it('removeFile by index', () => {
    const s0 = init({ multiple: true, files: [makeFile('a', 1), makeFile('b', 1)] })
    const [s] = update(s0, { type: 'removeFile', index: 0 })
    expect(s.files.map((f) => f.name)).toEqual(['b'])
  })

  it('clear empties files', () => {
    const s0 = init({ files: [makeFile('a', 1)] })
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
    const s = init({ multiple: true, files: [makeFile('a', 100), makeFile('b', 200)] })
    expect(totalSize(s)).toBe(300)
  })
})

describe('file-upload.connect', () => {
  it('hiddenInput has id from options', () => {
    const p = connect<Ctx>((s) => s.u, vi.fn(), { id: 'up1' })
    expect(p.hiddenInput.id).toBe('up1:input')
    expect(p.label.for).toBe('up1:input')
  })

  it('onDrop sends drop + addFiles', () => {
    const send = vi.fn()
    const pc = connect<Ctx>((s) => s.u, send, { id: 'x' })
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
    const pc = connect<Ctx>((s) => s.u, send, { id: 'x' })
    pc.clearTrigger.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'clear' })
  })
})

describe('validateFiles', () => {
  it('records TOO_LARGE errors', () => {
    const s = init({ maxSize: 50 })
    const { accepted, rejected } = validateFiles([makeFile('big', 100)], s, 0)
    expect(accepted).toHaveLength(0)
    expect(rejected[0]!.errors).toContainEqual({ code: 'TOO_LARGE', max: 50 })
  })

  it('records TOO_SMALL errors', () => {
    const s = init({ minFileSize: 50 })
    const { accepted, rejected } = validateFiles([makeFile('tiny', 10)], s, 0)
    expect(accepted).toHaveLength(0)
    expect(rejected[0]!.errors).toContainEqual({ code: 'TOO_SMALL', min: 50 })
  })

  it('records TOO_MANY when maxFiles exceeded', () => {
    const s = init({ maxFiles: 2 })
    const { accepted, rejected } = validateFiles(
      [makeFile('a', 1), makeFile('b', 1), makeFile('c', 1)],
      s,
      0,
    )
    expect(accepted.map((f) => f.name)).toEqual(['a', 'b'])
    expect(rejected[0]!.errors).toContainEqual({ code: 'TOO_MANY', max: 2 })
  })

  it('records INVALID_TYPE against MIME-object accept', () => {
    const s = init({ accept: { 'image/*': ['.png'] } })
    const { accepted, rejected } = validateFiles([makeFile('doc.txt', 10)], s, 0)
    expect(accepted).toHaveLength(0)
    expect(rejected[0]!.errors).toContainEqual({ code: 'INVALID_TYPE' })
  })

  it('string accept is permissive (browser-side filter only)', () => {
    const s = init({ accept: 'image/*' })
    const { accepted } = validateFiles([makeFile('doc.txt', 10)], s, 0)
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
      files: [makeFile('ok', 10), makeFile('toobig', 100)],
    })
    expect(s.files.map((f) => f.name)).toEqual(['ok'])
    expect(s.rejectedFiles[0]!.file.name).toBe('toobig')
  })

  it('clearRejected leaves files alone', () => {
    const s0 = init({ multiple: true, maxSize: 50 })
    const [s1] = update(s0, {
      type: 'addFiles',
      files: [makeFile('ok', 10), makeFile('big', 100)],
    })
    const [s2] = update(s1, { type: 'clearRejected' })
    expect(s2.rejectedFiles).toEqual([])
    expect(s2.files.map((f) => f.name)).toEqual(['ok'])
  })

  it('removeRejected by index', () => {
    const s0 = init({ multiple: true, maxSize: 5 })
    const [s1] = update(s0, {
      type: 'addFiles',
      files: [makeFile('a', 100), makeFile('b', 100)],
    })
    const [s2] = update(s1, { type: 'removeRejected', index: 0 })
    expect(s2.rejectedFiles.map((r) => r.file.name)).toEqual(['b'])
  })
})

describe('readOnly + invalid', () => {
  it('readOnly blocks addFiles and setFiles', () => {
    const s0 = init({ readOnly: true })
    const [s1] = update(s0, { type: 'addFiles', files: [makeFile('a', 1)] })
    expect(s1.files).toEqual([])
    const [s2] = update(s0, { type: 'setFiles', files: [makeFile('b', 1)] })
    expect(s2.files).toEqual([])
  })

  it('setInvalid toggles state.invalid', () => {
    const [s1] = update(init(), { type: 'setInvalid', invalid: true })
    expect(s1.invalid).toBe(true)
  })
})

describe('connect: new parts + attrs', () => {
  it('hiddenInput forwards required + aria-invalid', () => {
    const p = connect<Ctx>((s) => s.u, vi.fn(), { id: 'x' })
    expect(p.hiddenInput.required({ u: init({ required: true }) })).toBe(true)
    expect(p.hiddenInput['aria-invalid']({ u: init({ invalid: true }) })).toBe('true')
    expect(p.hiddenInput['aria-invalid']({ u: init() })).toBeUndefined()
  })

  it('root exposes data-invalid + data-readonly', () => {
    const p = connect<Ctx>((s) => s.u, vi.fn(), { id: 'x' })
    expect(p.root['data-invalid']({ u: init({ invalid: true }) })).toBe('')
    expect(p.root['data-readonly']({ u: init({ readOnly: true }) })).toBe('')
  })

  it('capture + directory options set hidden input attrs', () => {
    const p1 = connect<Ctx>((s) => s.u, vi.fn(), { id: 'x', capture: 'environment' })
    expect(p1.hiddenInput.capture).toBe('environment')

    const p2 = connect<Ctx>((s) => s.u, vi.fn(), { id: 'x', directory: true })
    expect(p2.hiddenInput.webkitdirectory).toBe('')
  })

  it('custom validate adds to rejectedFiles via the pipeline', async () => {
    const send = vi.fn()
    const pc = connect<Ctx>((s) => s.u, send, {
      id: 'x',
      validate: (file) =>
        file.name.endsWith('.bad') ? [{ code: 'CUSTOM', message: 'banned name' }] : null,
    })
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
        files: [ok],
        customRejected: [{ file: bad, errors: [{ code: 'CUSTOM', message: 'banned name' }] }],
      }),
    )
  })

  it('transformFiles runs before validation', async () => {
    const send = vi.fn()
    const pc = connect<Ctx>((s) => s.u, send, {
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
    const pc = connect<Ctx>((s) => s.u, send, { id: 'x' })
    const input = document.createElement('input')
    Object.defineProperty(input, 'files', { value: [makeFile('a.txt', 5)] })
    pc.hiddenInput.onChange({ target: input } as unknown as Event)
    // Synchronous path — no await needed
    expect(send).toHaveBeenCalledWith({
      type: 'addFiles',
      files: expect.arrayContaining([expect.any(File)]),
    })
    expect(send.mock.calls[0]![0].customRejected).toBeUndefined()
  })

  it('itemDeleteTrigger is a zag-aligned alias for removeTrigger', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.u, send, { id: 'x' })
    p.item(2).itemDeleteTrigger.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'removeFile', index: 2 })
  })
})
