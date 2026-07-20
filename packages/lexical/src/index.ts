// `@llui/lexical` — low-level binding between Lexical and the LLui signal runtime.

export {
  type ShortcutSpec,
  type PluginContext,
  type DecoratorApi,
  type DecoratorBridge,
  type LexicalPlugin,
  decoratorBridge,
} from './plugin.js'

export {
  type ParsedCombo,
  parseCombo,
  matchesCombo,
  isMacPlatform,
  registerShortcuts,
} from './register.js'

export {
  type BaseBlockType,
  type Alignment,
  type BaseFormat,
  $readBaseFormat,
  readBaseFormat,
} from './selection.js'

export {
  PROGRAMMATIC_TAG,
  type SelectionContext,
  type LexicalForeignOptions,
  lexicalForeign,
} from './foreign.js'

export {
  type WidgetPlacement,
  type WidgetContext,
  type WidgetDisposeContext,
  type WidgetSpec,
  type NodeWidget,
  type WidgetRuntime,
  WIDGET_CLASS,
  WIDGET_ATTR,
  nodeWidget,
  createWidgetRuntime,
  isNodeWidgetHost,
} from './nodewidget.js'

export {
  type SerializedLLuiDecoratorNode,
  LLuiDecoratorNode,
  $createLLuiDecoratorNode,
  $isLLuiDecoratorNode,
  registerDecoratorBridges,
} from './decorator.js'
