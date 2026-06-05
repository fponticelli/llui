/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { testComponent, reducer } from '@llui/test'
import {
  buildSelector,
  pickInit,
  pickReduce,
  type PickState,
  type PickMsg,
  type PickEffect,
} from '../src/element-picker.js'
import type { NoteRect } from '../src/note-types.js'

const pickDef = reducer<PickState, PickMsg, PickEffect>({
  init: () => [pickInit(), []],
  update: pickReduce,
})

const bbox = (x: number, y: number, w: number, h: number): NoteRect => ({ x, y, w, h })

describe('element-picker reducer', () => {
  it('starts in the picking phase with no outline', () => {
    const h = testComponent(pickDef)
    expect(h.state.phase).toBe('picking')
    expect(h.state.outline).toBe(null)
  })

  it('hover records the outline + selector + label', () => {
    const h = testComponent(pickDef)
    h.send({
      type: 'hover',
      bbox: bbox(10, 20, 30, 40),
      selector: '#main',
      label: '#main  30×40',
      labelTop: 2,
      labelLeft: 10,
    })
    expect(h.state.outline).toEqual(bbox(10, 20, 30, 40))
    expect(h.state.selector).toBe('#main')
    expect(h.state.labelText).toBe('#main  30×40')
  })

  it('pick after a hover emits resolve:submit with selector + bbox and lingers', () => {
    const h = testComponent(pickDef)
    h.send({
      type: 'hover',
      bbox: bbox(5, 5, 100, 50),
      selector: 'div.card',
      label: 'div.card  100×50',
      labelTop: 2,
      labelLeft: 5,
    })
    h.send({ type: 'pick' })
    expect(h.state.phase).toBe('picked')
    expect(h.effects).toEqual([
      { type: 'resolve', reason: 'submit', selector: 'div.card', bbox: bbox(5, 5, 100, 50) },
    ])
  })

  it('pick with no hovered element resolves cancel', () => {
    const h = testComponent(pickDef)
    h.send({ type: 'pick' })
    expect(h.effects).toEqual([{ type: 'resolve', reason: 'cancel' }])
  })

  it('cancel resolves cancel', () => {
    const h = testComponent(pickDef)
    h.send({ type: 'cancel' })
    expect(h.effects).toEqual([{ type: 'resolve', reason: 'cancel' }])
  })

  it('hover after picked is ignored', () => {
    const h = testComponent(pickDef)
    h.send({
      type: 'hover',
      bbox: bbox(5, 5, 100, 50),
      selector: 'div.card',
      label: 'x',
      labelTop: 0,
      labelLeft: 0,
    })
    h.send({ type: 'pick' })
    h.send({
      type: 'hover',
      bbox: bbox(0, 0, 1, 1),
      selector: 'other',
      label: 'y',
      labelTop: 0,
      labelLeft: 0,
    })
    expect(h.state.selector).toBe('div.card')
  })
})

describe('buildSelector', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('prefers #id and stops climbing', () => {
    document.body.innerHTML = '<section id="hero"><button class="cta">Go</button></section>'
    const btn = document.querySelector('button')!
    expect(buildSelector(btn)).toBe('#hero > button.cta')
  })

  it('uses tag.class, skipping llui- classes', () => {
    document.body.innerHTML = '<div class="llui-x panel"><span class="label">hi</span></div>'
    const span = document.querySelector('span')!
    // body has no id/class → falls through to tag at the top of the chain
    expect(buildSelector(span)).toContain('span.label')
    expect(buildSelector(span)).toContain('div.panel')
    expect(buildSelector(span)).not.toContain('llui-x')
  })

  it('falls back to nth-of-type among same-tag siblings', () => {
    document.body.innerHTML = '<ul id="list"><li>a</li><li>b</li><li>c</li></ul>'
    const second = document.querySelectorAll('li')[1]!
    expect(buildSelector(second)).toBe('#list > li:nth-of-type(2)')
  })
})
