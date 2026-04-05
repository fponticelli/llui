import { describe, it, expect, vi } from 'vitest'
import { init, update, connect, totalSize } from '../../src/components/file-upload'
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
