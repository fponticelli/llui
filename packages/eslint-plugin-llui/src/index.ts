import spreadInChildren from './rules/spread-in-children'
import viewBagImport from './rules/view-bag-import'
import forgottenSpread from './rules/forgotten-spread'
import stringEffectCallback from './rules/string-effect-callback'
import imperativeDomInView from './rules/imperative-dom-in-view'
import nestedSendInUpdate from './rules/nested-send-in-update'
import accessorSideEffect from './rules/accessor-side-effect'
import asyncUpdate from './rules/async-update'
import effectWithoutHandler from './rules/effect-without-handler'
import exhaustiveEffectHandling from './rules/exhaustive-effect-handling'
import directStateInView from './rules/direct-state-in-view'

export const rules = {
  'spread-in-children': spreadInChildren,
  'view-bag-import': viewBagImport,
  'forgotten-spread': forgottenSpread,
  'string-effect-callback': stringEffectCallback,
  'imperative-dom-in-view': imperativeDomInView,
  'nested-send-in-update': nestedSendInUpdate,
  'accessor-side-effect': accessorSideEffect,
  'async-update': asyncUpdate,
  'effect-without-handler': effectWithoutHandler,
  'exhaustive-effect-handling': exhaustiveEffectHandling,
  'direct-state-in-view': directStateInView,
}

export const configs = {
  recommended: {
    plugins: ['llui'],
    rules: {
      'llui/spread-in-children': 'error',
      'llui/view-bag-import': 'error',
      'llui/forgotten-spread': 'error',
      'llui/string-effect-callback': 'error',
      'llui/imperative-dom-in-view': 'error',
      'llui/nested-send-in-update': 'error',
      'llui/accessor-side-effect': 'error',
      'llui/async-update': 'error',
      'llui/effect-without-handler': 'error',
      'llui/exhaustive-effect-handling': 'error',
      'llui/direct-state-in-view': 'error',
    },
  },
}
