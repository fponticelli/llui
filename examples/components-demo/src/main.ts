import {
  component,
  mountApp,
  mergeHandlers,
  sliceHandler,
  div,
  button,
  span,
  text,
  h1,
  h2,
  h3,
  p,
  label,
  input,
  img,
  each,
  onMount,
} from '@llui/dom'

import { switchMachine, type SwitchState, type SwitchMsg } from '@llui/components/switch'
import { checkbox, type CheckboxState, type CheckboxMsg } from '@llui/components/checkbox'
import { radioGroup, type RadioGroupState, type RadioGroupMsg } from '@llui/components/radio-group'
import {
  toggleGroup,
  type ToggleGroupState,
  type ToggleGroupMsg,
} from '@llui/components/toggle-group'
import { slider, type SliderState, type SliderMsg } from '@llui/components/slider'
import { progress, type ProgressState, type ProgressMsg } from '@llui/components/progress'
import {
  numberInput,
  type NumberInputState,
  type NumberInputMsg,
} from '@llui/components/number-input'
import {
  passwordInput,
  type PasswordInputState,
  type PasswordInputMsg,
} from '@llui/components/password-input'
import {
  ratingGroup,
  type RatingGroupState,
  type RatingGroupMsg,
} from '@llui/components/rating-group'
import { pagination, type PaginationState, type PaginationMsg } from '@llui/components/pagination'
import { avatar, type AvatarState, type AvatarMsg } from '@llui/components/avatar'
import { tabs, type TabsState, type TabsMsg } from '@llui/components/tabs'
import { accordion, type AccordionState, type AccordionMsg } from '@llui/components/accordion'
import { popover, type PopoverState, type PopoverMsg } from '@llui/components/popover'
import { tooltip, type TooltipState, type TooltipMsg } from '@llui/components/tooltip'
import { hoverCard, type HoverCardState, type HoverCardMsg } from '@llui/components/hover-card'
import { menu, type MenuState, type MenuMsg } from '@llui/components/menu'
import { select, type SelectState, type SelectMsg } from '@llui/components/select'
import { combobox, type ComboboxState, type ComboboxMsg } from '@llui/components/combobox'
import { drawer, type DrawerState, type DrawerMsg } from '@llui/components/drawer'
import {
  contextMenu,
  type ContextMenuState,
  type ContextMenuMsg,
} from '@llui/components/context-menu'
import { carousel, type CarouselState, type CarouselMsg } from '@llui/components/carousel'
import {
  colorPicker,
  type ColorPickerState,
  type ColorPickerMsg,
} from '@llui/components/color-picker'
import {
  datePicker,
  type DatePickerState,
  type DatePickerMsg,
  monthGrid,
} from '@llui/components/date-picker'
import {
  timePicker,
  type TimePickerState,
  type TimePickerMsg,
  formatTime,
} from '@llui/components/time-picker'
import {
  clipboard,
  type ClipboardState,
  type ClipboardMsg,
  copyToClipboard,
} from '@llui/components/clipboard'
import { editable, type EditableState, type EditableMsg } from '@llui/components/editable'
import { tagsInput, type TagsInputState, type TagsInputMsg } from '@llui/components/tags-input'
import { stepper, type StepperState, type StepperMsg } from '@llui/components/stepper'
import { pinInput, type PinInputState, type PinInputMsg } from '@llui/components/pin-input'
import { fileUpload, type FileUploadState, type FileUploadMsg } from '@llui/components/file-upload'
import { splitter, type SplitterState, type SplitterMsg } from '@llui/components/splitter'
import { treeView, type TreeViewState, type TreeViewMsg } from '@llui/components/tree-view'
import { toast, type ToasterState, type ToasterMsg, nextToastId } from '@llui/components/toast'
import {
  confirmDialog,
  type ConfirmDialogState,
  type ConfirmDialogMsg,
  openWith,
} from '@llui/components/patterns/confirm-dialog'

// ── State ───────────────────────────────────────────────────────────────────

type State = {
  switch: SwitchState
  checkbox: CheckboxState
  radio: RadioGroupState
  togGroup: ToggleGroupState
  slider: SliderState
  progress: ProgressState
  number: NumberInputState
  password: PasswordInputState
  rating: RatingGroupState
  pagination: PaginationState
  avatar: AvatarState
  tabs: TabsState
  accordion: AccordionState
  popover: PopoverState
  tooltip: TooltipState
  hoverCard: HoverCardState
  menu: MenuState
  select: SelectState
  combobox: ComboboxState
  drawer: DrawerState
  contextMenu: ContextMenuState
  carousel: CarouselState
  colorPicker: ColorPickerState
  datePicker: DatePickerState
  timePicker: TimePickerState
  clipboard: ClipboardState
  editable: EditableState
  tagsInput: TagsInputState
  stepper: StepperState
  pinInput: PinInputState
  fileUpload: FileUploadState
  splitter: SplitterState
  treeView: TreeViewState
  toast: ToasterState
  confirm: ConfirmDialogState
  message: string
}

type Msg =
  | { type: 'switch'; msg: SwitchMsg }
  | { type: 'checkbox'; msg: CheckboxMsg }
  | { type: 'radio'; msg: RadioGroupMsg }
  | { type: 'togGroup'; msg: ToggleGroupMsg }
  | { type: 'slider'; msg: SliderMsg }
  | { type: 'progress'; msg: ProgressMsg }
  | { type: 'number'; msg: NumberInputMsg }
  | { type: 'password'; msg: PasswordInputMsg }
  | { type: 'rating'; msg: RatingGroupMsg }
  | { type: 'pagination'; msg: PaginationMsg }
  | { type: 'avatar'; msg: AvatarMsg }
  | { type: 'tabs'; msg: TabsMsg }
  | { type: 'accordion'; msg: AccordionMsg }
  | { type: 'popover'; msg: PopoverMsg }
  | { type: 'tooltip'; msg: TooltipMsg }
  | { type: 'hoverCard'; msg: HoverCardMsg }
  | { type: 'menu'; msg: MenuMsg }
  | { type: 'select'; msg: SelectMsg }
  | { type: 'combobox'; msg: ComboboxMsg }
  | { type: 'drawer'; msg: DrawerMsg }
  | { type: 'contextMenu'; msg: ContextMenuMsg }
  | { type: 'carousel'; msg: CarouselMsg }
  | { type: 'colorPicker'; msg: ColorPickerMsg }
  | { type: 'datePicker'; msg: DatePickerMsg }
  | { type: 'timePicker'; msg: TimePickerMsg }
  | { type: 'clipboard'; msg: ClipboardMsg }
  | { type: 'editable'; msg: EditableMsg }
  | { type: 'tagsInput'; msg: TagsInputMsg }
  | { type: 'stepper'; msg: StepperMsg }
  | { type: 'pinInput'; msg: PinInputMsg }
  | { type: 'fileUpload'; msg: FileUploadMsg }
  | { type: 'splitter'; msg: SplitterMsg }
  | { type: 'treeView'; msg: TreeViewMsg }
  | { type: 'copyText'; value: string }
  | { type: 'toast'; msg: ToasterMsg }
  | { type: 'confirm'; msg: ConfirmDialogMsg }
  | { type: 'emitToast'; kind: 'info' | 'success' | 'error' }
  | { type: 'askConfirm' }

// ── Init ────────────────────────────────────────────────────────────────────

const FRUITS = [
  'Apple',
  'Apricot',
  'Banana',
  'Blackberry',
  'Blueberry',
  'Cherry',
  'Coconut',
  'Fig',
  'Grape',
  'Lemon',
  'Mango',
  'Orange',
  'Papaya',
  'Peach',
  'Pear',
  'Pineapple',
  'Raspberry',
  'Strawberry',
  'Watermelon',
]

const init = (): [State, never[]] => [
  {
    switch: switchMachine.init({ checked: false }),
    checkbox: checkbox.init({ checked: 'indeterminate' }),
    radio: radioGroup.init({ items: ['small', 'medium', 'large'], value: 'medium' }),
    togGroup: toggleGroup.init({
      items: ['bold', 'italic', 'underline'],
      value: ['bold'],
      type: 'multiple',
    }),
    slider: slider.init({ value: [40], min: 0, max: 100, step: 5 }),
    progress: progress.init({ value: 65 }),
    number: numberInput.init({ value: 10, min: 0, max: 100, step: 1 }),
    password: passwordInput.init({ value: 'hunter2' }),
    rating: ratingGroup.init({ value: 3, count: 5, allowHalf: true }),
    pagination: pagination.init({ total: 100, pageSize: 10, page: 3 }),
    avatar: avatar.init(),
    tabs: tabs.init({ items: ['overview', 'specs', 'reviews'], value: 'overview' }),
    accordion: accordion.init({
      items: ['what', 'why', 'how'],
      value: ['what'],
      collapsible: true,
    }),
    popover: popover.init({ open: false }),
    tooltip: tooltip.init({ open: false }),
    hoverCard: hoverCard.init({ open: false }),
    menu: menu.init({ items: ['Edit', 'Duplicate', 'Archive', 'Delete'], open: false }),
    select: select.init({
      items: ['Red', 'Green', 'Blue', 'Purple', 'Orange'],
      value: ['Blue'],
    }),
    combobox: combobox.init({ items: FRUITS }),
    drawer: drawer.init({ open: false }),
    contextMenu: contextMenu.init({ items: ['Cut', 'Copy', 'Paste', 'Delete'] }),
    carousel: carousel.init({ count: 4, current: 0, loop: true }),
    colorPicker: colorPicker.init({ hsl: { h: 210, s: 70, l: 50 } }),
    datePicker: datePicker.init({ value: '2026-04-15' }),
    timePicker: timePicker.init({ value: { hours: 14, minutes: 30, seconds: 0 }, format: '12' }),
    clipboard: clipboard.init({ value: 'pnpm install @llui/components' }),
    editable: editable.init({ value: 'Click me to edit' }),
    tagsInput: tagsInput.init({ value: ['typescript', 'vite'], unique: true, max: 5 }),
    stepper: stepper.init({ steps: ['Account', 'Profile', 'Review'], current: 0, linear: true }),
    pinInput: pinInput.init({ length: 4, type: 'numeric' }),
    fileUpload: fileUpload.init({ multiple: true, maxFiles: 3 }),
    splitter: splitter.init({ position: 50, orientation: 'horizontal' }),
    treeView: treeView.init({
      expanded: ['root'],
      visibleItems: ['root', 'docs', 'src', 'tests'],
      selectionMode: 'single',
    }),
    toast: toast.init({ placement: 'bottom-end' }),
    confirm: confirmDialog.init(),
    message: '',
  },
  [],
]

// ── Update ──────────────────────────────────────────────────────────────────

const appUpdate = (state: State, msg: Msg): [State, never[]] | null => {
  if (msg.type === 'emitToast') {
    const title =
      msg.kind === 'success'
        ? 'Saved!'
        : msg.kind === 'error'
          ? 'Something went wrong'
          : 'For your information'
    const description =
      msg.kind === 'success'
        ? 'Your changes have been saved.'
        : msg.kind === 'error'
          ? 'Please try again later.'
          : 'This is an informational message.'
    const [toastState] = toast.update(state.toast, {
      type: 'create',
      toast: {
        id: nextToastId(),
        type: msg.kind,
        title,
        description,
        duration: 3000,
        dismissable: true,
      },
    })
    return [{ ...state, toast: toastState }, []]
  }
  if (msg.type === 'copyText') {
    // Fire-and-forget browser clipboard write; state update happens below.
    void copyToClipboard(msg.value).catch(() => {})
    const [cb] = clipboard.update(state.clipboard, { type: 'copy' })
    // Auto-reset the "copied" flag after 2s so the button label returns to "Copy"
    setTimeout(() => sendGlobal({ type: 'clipboard', msg: { type: 'reset' } }), 2000)
    return [{ ...state, clipboard: cb }, []]
  }
  if (msg.type === 'askConfirm') {
    const [confirm] = confirmDialog.update(
      state.confirm,
      openWith('demo-confirm', {
        title: 'Delete this item?',
        description: 'This action cannot be undone.',
        confirmLabel: 'Delete',
        cancelLabel: 'Cancel',
        destructive: true,
      }),
    )
    return [{ ...state, confirm }, []]
  }
  return null
}

const update = mergeHandlers<State, Msg, never>(
  sliceHandler({
    get: (s) => s.switch,
    set: (s, v) => ({ ...s, switch: v }),
    narrow: (m) => (m.type === 'switch' ? m.msg : null),
    sub: switchMachine.update,
  }),
  sliceHandler({
    get: (s) => s.checkbox,
    set: (s, v) => ({ ...s, checkbox: v }),
    narrow: (m) => (m.type === 'checkbox' ? m.msg : null),
    sub: checkbox.update,
  }),
  sliceHandler({
    get: (s) => s.radio,
    set: (s, v) => ({ ...s, radio: v }),
    narrow: (m) => (m.type === 'radio' ? m.msg : null),
    sub: radioGroup.update,
  }),
  sliceHandler({
    get: (s) => s.togGroup,
    set: (s, v) => ({ ...s, togGroup: v }),
    narrow: (m) => (m.type === 'togGroup' ? m.msg : null),
    sub: toggleGroup.update,
  }),
  sliceHandler({
    get: (s) => s.slider,
    set: (s, v) => ({ ...s, slider: v }),
    narrow: (m) => (m.type === 'slider' ? m.msg : null),
    sub: slider.update,
  }),
  sliceHandler({
    get: (s) => s.progress,
    set: (s, v) => ({ ...s, progress: v }),
    narrow: (m) => (m.type === 'progress' ? m.msg : null),
    sub: progress.update,
  }),
  sliceHandler({
    get: (s) => s.number,
    set: (s, v) => ({ ...s, number: v }),
    narrow: (m) => (m.type === 'number' ? m.msg : null),
    sub: numberInput.update,
  }),
  sliceHandler({
    get: (s) => s.password,
    set: (s, v) => ({ ...s, password: v }),
    narrow: (m) => (m.type === 'password' ? m.msg : null),
    sub: passwordInput.update,
  }),
  sliceHandler({
    get: (s) => s.rating,
    set: (s, v) => ({ ...s, rating: v }),
    narrow: (m) => (m.type === 'rating' ? m.msg : null),
    sub: ratingGroup.update,
  }),
  sliceHandler({
    get: (s) => s.pagination,
    set: (s, v) => ({ ...s, pagination: v }),
    narrow: (m) => (m.type === 'pagination' ? m.msg : null),
    sub: pagination.update,
  }),
  sliceHandler({
    get: (s) => s.avatar,
    set: (s, v) => ({ ...s, avatar: v }),
    narrow: (m) => (m.type === 'avatar' ? m.msg : null),
    sub: avatar.update,
  }),
  sliceHandler({
    get: (s) => s.tabs,
    set: (s, v) => ({ ...s, tabs: v }),
    narrow: (m) => (m.type === 'tabs' ? m.msg : null),
    sub: tabs.update,
  }),
  sliceHandler({
    get: (s) => s.accordion,
    set: (s, v) => ({ ...s, accordion: v }),
    narrow: (m) => (m.type === 'accordion' ? m.msg : null),
    sub: accordion.update,
  }),
  sliceHandler({
    get: (s) => s.popover,
    set: (s, v) => ({ ...s, popover: v }),
    narrow: (m) => (m.type === 'popover' ? m.msg : null),
    sub: popover.update,
  }),
  sliceHandler({
    get: (s) => s.tooltip,
    set: (s, v) => ({ ...s, tooltip: v }),
    narrow: (m) => (m.type === 'tooltip' ? m.msg : null),
    sub: tooltip.update,
  }),
  sliceHandler({
    get: (s) => s.hoverCard,
    set: (s, v) => ({ ...s, hoverCard: v }),
    narrow: (m) => (m.type === 'hoverCard' ? m.msg : null),
    sub: hoverCard.update,
  }),
  sliceHandler({
    get: (s) => s.menu,
    set: (s, v) => ({ ...s, menu: v }),
    narrow: (m) => (m.type === 'menu' ? m.msg : null),
    sub: menu.update,
  }),
  sliceHandler({
    get: (s) => s.select,
    set: (s, v) => ({ ...s, select: v }),
    narrow: (m) => (m.type === 'select' ? m.msg : null),
    sub: select.update,
  }),
  sliceHandler({
    get: (s) => s.combobox,
    set: (s, v) => ({ ...s, combobox: v }),
    narrow: (m) => (m.type === 'combobox' ? m.msg : null),
    sub: combobox.update,
  }),
  sliceHandler({
    get: (s) => s.drawer,
    set: (s, v) => ({ ...s, drawer: v }),
    narrow: (m) => (m.type === 'drawer' ? m.msg : null),
    sub: drawer.update,
  }),
  sliceHandler({
    get: (s) => s.contextMenu,
    set: (s, v) => ({ ...s, contextMenu: v }),
    narrow: (m) => (m.type === 'contextMenu' ? m.msg : null),
    sub: contextMenu.update,
  }),
  sliceHandler({
    get: (s) => s.carousel,
    set: (s, v) => ({ ...s, carousel: v }),
    narrow: (m) => (m.type === 'carousel' ? m.msg : null),
    sub: carousel.update,
  }),
  sliceHandler({
    get: (s) => s.colorPicker,
    set: (s, v) => ({ ...s, colorPicker: v }),
    narrow: (m) => (m.type === 'colorPicker' ? m.msg : null),
    sub: colorPicker.update,
  }),
  sliceHandler({
    get: (s) => s.datePicker,
    set: (s, v) => ({ ...s, datePicker: v }),
    narrow: (m) => (m.type === 'datePicker' ? m.msg : null),
    sub: datePicker.update,
  }),
  sliceHandler({
    get: (s) => s.timePicker,
    set: (s, v) => ({ ...s, timePicker: v }),
    narrow: (m) => (m.type === 'timePicker' ? m.msg : null),
    sub: timePicker.update,
  }),
  sliceHandler({
    get: (s) => s.clipboard,
    set: (s, v) => ({ ...s, clipboard: v }),
    narrow: (m) => (m.type === 'clipboard' ? m.msg : null),
    sub: clipboard.update,
  }),
  sliceHandler({
    get: (s) => s.editable,
    set: (s, v) => ({ ...s, editable: v }),
    narrow: (m) => (m.type === 'editable' ? m.msg : null),
    sub: editable.update,
  }),
  sliceHandler({
    get: (s) => s.tagsInput,
    set: (s, v) => ({ ...s, tagsInput: v }),
    narrow: (m) => (m.type === 'tagsInput' ? m.msg : null),
    sub: tagsInput.update,
  }),
  sliceHandler({
    get: (s) => s.stepper,
    set: (s, v) => ({ ...s, stepper: v }),
    narrow: (m) => (m.type === 'stepper' ? m.msg : null),
    sub: stepper.update,
  }),
  sliceHandler({
    get: (s) => s.pinInput,
    set: (s, v) => ({ ...s, pinInput: v }),
    narrow: (m) => (m.type === 'pinInput' ? m.msg : null),
    sub: pinInput.update,
  }),
  sliceHandler({
    get: (s) => s.fileUpload,
    set: (s, v) => ({ ...s, fileUpload: v }),
    narrow: (m) => (m.type === 'fileUpload' ? m.msg : null),
    sub: fileUpload.update,
  }),
  sliceHandler({
    get: (s) => s.splitter,
    set: (s, v) => ({ ...s, splitter: v }),
    narrow: (m) => (m.type === 'splitter' ? m.msg : null),
    sub: splitter.update,
  }),
  sliceHandler({
    get: (s) => s.treeView,
    set: (s, v) => ({ ...s, treeView: v }),
    narrow: (m) => (m.type === 'treeView' ? m.msg : null),
    sub: treeView.update,
  }),
  sliceHandler({
    get: (s) => s.toast,
    set: (s, v) => ({ ...s, toast: v }),
    narrow: (m) => (m.type === 'toast' ? m.msg : null),
    sub: toast.update,
  }),
  // confirm-dialog with tag branching
  (state, msg) => {
    if (msg.type !== 'confirm') return null
    const [confirm] = confirmDialog.update(state.confirm, msg.msg)
    if (msg.msg.type === 'confirm') {
      // user confirmed — use state.confirm.tag to know what was confirmed
      return [{ ...state, confirm, message: `Confirmed: ${state.confirm.tag}` }, []]
    }
    if (msg.msg.type === 'cancel') {
      return [{ ...state, confirm, message: 'Cancelled' }, []]
    }
    return [{ ...state, confirm }, []]
  },
  appUpdate,
)

// ── View ────────────────────────────────────────────────────────────────────

const switchParts = switchMachine.connect<State>(
  (s) => s.switch,
  (m) => sendGlobal({ type: 'switch', msg: m }),
)
const checkboxParts = checkbox.connect<State>(
  (s) => s.checkbox,
  (m) => sendGlobal({ type: 'checkbox', msg: m }),
)
const radioParts = radioGroup.connect<State>(
  (s) => s.radio,
  (m) => sendGlobal({ type: 'radio', msg: m }),
  { id: 'radio-demo' },
)
const togGroupParts = toggleGroup.connect<State>(
  (s) => s.togGroup,
  (m) => sendGlobal({ type: 'togGroup', msg: m }),
)
const numberParts = numberInput.connect<State>(
  (s) => s.number,
  (m) => sendGlobal({ type: 'number', msg: m }),
)
const passwordParts = passwordInput.connect<State>(
  (s) => s.password,
  (m) => sendGlobal({ type: 'password', msg: m }),
)
const ratingParts = ratingGroup.connect<State>(
  (s) => s.rating,
  (m) => sendGlobal({ type: 'rating', msg: m }),
  { label: 'Rate this product' },
)
const paginationParts = pagination.connect<State>(
  (s) => s.pagination,
  (m) => sendGlobal({ type: 'pagination', msg: m }),
)
const avatarParts = avatar.connect<State>(
  (s) => s.avatar,
  (m) => sendGlobal({ type: 'avatar', msg: m }),
  { alt: 'User avatar' },
)
const tooltipParts = tooltip.connect<State>(
  (s) => s.tooltip,
  (m) => sendGlobal({ type: 'tooltip', msg: m }),
  { id: 'tip-demo', delayOpen: 300, delayClose: 100 },
)
const hoverCardParts = hoverCard.connect<State>(
  (s) => s.hoverCard,
  (m) => sendGlobal({ type: 'hoverCard', msg: m }),
  { id: 'hc-demo', openDelay: 400 },
)
const comboboxParts = combobox.connect<State>(
  (s) => s.combobox,
  (m) => sendGlobal({ type: 'combobox', msg: m }),
  { id: 'cb-demo' },
)
const drawerParts = drawer.connect<State>(
  (s) => s.drawer,
  (m) => sendGlobal({ type: 'drawer', msg: m }),
  { id: 'drawer-demo', side: 'right' },
)
const contextMenuParts = contextMenu.connect<State>(
  (s) => s.contextMenu,
  (m) => sendGlobal({ type: 'contextMenu', msg: m }),
  { id: 'cm-demo' },
)
const carouselParts = carousel.connect<State>(
  (s) => s.carousel,
  (m) => sendGlobal({ type: 'carousel', msg: m }),
  { id: 'carousel-demo' },
)
const colorPickerParts = colorPicker.connect<State>(
  (s) => s.colorPicker,
  (m) => sendGlobal({ type: 'colorPicker', msg: m }),
)
const datePickerParts = datePicker.connect<State>(
  (s) => s.datePicker,
  (m) => sendGlobal({ type: 'datePicker', msg: m }),
)
const timePickerParts = timePicker.connect<State>(
  (s) => s.timePicker,
  (m) => sendGlobal({ type: 'timePicker', msg: m }),
)
const clipboardParts = clipboard.connect<State>(
  (s) => s.clipboard,
  (m) => sendGlobal({ type: 'clipboard', msg: m }),
)
const editableParts = editable.connect<State>(
  (s) => s.editable,
  (m) => sendGlobal({ type: 'editable', msg: m }),
)
const tagsInputParts = tagsInput.connect<State>(
  (s) => s.tagsInput,
  (m) => sendGlobal({ type: 'tagsInput', msg: m }),
)
const stepperParts = stepper.connect<State>(
  (s) => s.stepper,
  (m) => sendGlobal({ type: 'stepper', msg: m }),
  { label: 'Signup progress' },
)
const pinInputParts = pinInput.connect<State>(
  (s) => s.pinInput,
  (m) => sendGlobal({ type: 'pinInput', msg: m }),
  { id: 'pin-demo' },
)
const fileUploadParts = fileUpload.connect<State>(
  (s) => s.fileUpload,
  (m) => sendGlobal({ type: 'fileUpload', msg: m }),
  { id: 'upload-demo' },
)
const splitterParts = splitter.connect<State>(
  (s) => s.splitter,
  (m) => sendGlobal({ type: 'splitter', msg: m }),
)
const treeViewParts = treeView.connect<State>(
  (s) => s.treeView,
  (m) => sendGlobal({ type: 'treeView', msg: m }),
  { id: 'tree-demo' },
)
const sliderParts = slider.connect<State>(
  (s) => s.slider,
  (m) => sendGlobal({ type: 'slider', msg: m }),
)
const progressParts = progress.connect<State>(
  (s) => s.progress,
  (m) => sendGlobal({ type: 'progress', msg: m }),
)
const tabsParts = tabs.connect<State>(
  (s) => s.tabs,
  (m) => sendGlobal({ type: 'tabs', msg: m }),
  { id: 'tabs-demo' },
)
const accordionParts = accordion.connect<State>(
  (s) => s.accordion,
  (m) => sendGlobal({ type: 'accordion', msg: m }),
  { id: 'acc-demo' },
)
const popoverParts = popover.connect<State>(
  (s) => s.popover,
  (m) => sendGlobal({ type: 'popover', msg: m }),
  { id: 'pop-demo' },
)
const menuParts = menu.connect<State>(
  (s) => s.menu,
  (m) => sendGlobal({ type: 'menu', msg: m }),
  {
    id: 'menu-demo',
    onSelect: () => sendGlobal({ type: 'emitToast', kind: 'info' }),
  },
)
const selectParts = select.connect<State>(
  (s) => s.select,
  (m) => sendGlobal({ type: 'select', msg: m }),
  { id: 'sel-demo', placeholder: 'Choose a color' },
)
const toastParts = toast.connect<State>(
  (s) => s.toast,
  (m) => sendGlobal({ type: 'toast', msg: m }),
)

let sendGlobal: (msg: Msg) => void = () => {
  throw new Error('send not initialized')
}

const Demo = component<State, Msg, never>({
  name: 'ComponentsDemo',
  init,
  update,
  view: (send) => {
    sendGlobal = send
    return [
      div({ class: 'space-y-6' }, [
        header(),
        sectionGroup('Form controls', [
          switchSection(),
          checkboxSection(),
          radioSection(),
          toggleGroupSection(),
          numberSection(),
          passwordSection(),
          pinInputSection(),
          tagsInputSection(),
          ratingSection(),
          sliderSection(),
          progressSection(),
        ]),
        sectionGroup('Pickers', [datePickerSection(), timePickerSection(), colorPickerSection()]),
        sectionGroup('Navigation & display', [
          tabsSection(),
          paginationSection(),
          stepperSection(),
          carouselSection(),
          avatarSection(),
          treeViewSection(),
        ]),
        sectionGroup('Inline editing', [
          editableSection(send),
          clipboardSection(send),
          fileUploadSection(),
          splitterSection(),
        ]),
        sectionGroup('Overlays', [
          popoverSection(send),
          tooltipSection(),
          hoverCardSection(),
          menuSection(),
          contextMenuSection(),
          selectSection(),
          comboboxSection(),
          drawerSection(send),
          toastSection(send),
          confirmSection(send),
        ]),
        sectionGroup('Disclosure', [accordionSection()]),
      ]),
      // Global overlays (portaled to body)
      ...toastRegion(),
      ...confirmDialogOverlay(send),
      ...drawerOverlay(send),
      ...contextMenuOverlay(send),
    ]
  },
})

// ── Sections ────────────────────────────────────────────────────────────────

function sectionGroup(title: string, sections: Node[]): Node {
  return div({}, [
    h2({ class: 'mt-8 mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500' }, [
      text(title),
    ]),
    div({ class: 'grid grid-cols-1 gap-4 md:grid-cols-2' }, sections),
  ])
}

function header(): Node {
  return div({ class: 'mb-4' }, [
    h1({ class: 'text-3xl font-bold' }, [text('LLui Components')]),
    p({ class: 'mt-1 text-slate-600' }, [
      text('Headless components styled with Tailwind via '),
      span({ class: 'font-mono text-sm' }, [text('data-scope')]),
      text(' / '),
      span({ class: 'font-mono text-sm' }, [text('data-part')]),
      text(' attributes.'),
    ]),
  ])
}

function switchSection(): Node {
  return div({ class: 'demo-section' }, [
    h2({ class: 'demo-title' }, [text('Switch')]),
    label({ class: 'flex items-center gap-3' }, [
      button({ ...switchParts.root }, [
        div({ ...switchParts.track }, [div({ ...switchParts.thumb }, [])]),
      ]),
      span({ class: 'text-sm' }, [
        text((s: State) => (s.switch.checked ? 'Notifications on' : 'Notifications off')),
      ]),
    ]),
  ])
}

function progressSection(): Node {
  return div({ class: 'demo-section' }, [
    h2({ class: 'demo-title' }, [text('Progress')]),
    div({ ...progressParts.root, 'aria-label': 'Upload progress' }, [
      div({ ...progressParts.track }, [div({ ...progressParts.range }, [])]),
    ]),
    div({ class: 'mt-2 text-sm text-slate-600' }, [
      text((s: State) => progressParts.valueText({ ...s })),
    ]),
    div({ class: 'mt-3 flex gap-2' }, [
      button(
        {
          class: 'btn btn-secondary text-xs',
          onClick: () => sendGlobal({ type: 'progress', msg: { type: 'setValue', value: 25 } }),
        },
        [text('25%')],
      ),
      button(
        {
          class: 'btn btn-secondary text-xs',
          onClick: () => sendGlobal({ type: 'progress', msg: { type: 'setValue', value: 65 } }),
        },
        [text('65%')],
      ),
      button(
        {
          class: 'btn btn-secondary text-xs',
          onClick: () => sendGlobal({ type: 'progress', msg: { type: 'setValue', value: 100 } }),
        },
        [text('100%')],
      ),
      button(
        {
          class: 'btn btn-secondary text-xs',
          onClick: () => sendGlobal({ type: 'progress', msg: { type: 'setValue', value: null } }),
        },
        [text('Indeterminate')],
      ),
    ]),
  ])
}

function sliderSection(): Node {
  // Wire pointer drag: find the control element at mount time and dispatch
  // setThumb messages as the pointer moves. min/max/step match the slider.init
  // config at the top of this file.
  onMount(() => {
    const control = document.querySelector(
      '[data-scope="slider"][data-part="control"]',
    ) as HTMLElement | null
    if (!control) return

    const MIN = 0
    const MAX = 100
    const STEP = 5
    let dragging = false

    const computeValue = (clientX: number): number => {
      const rect = control.getBoundingClientRect()
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      const raw = MIN + pct * (MAX - MIN)
      return Math.round(raw / STEP) * STEP
    }

    const onDown = (e: PointerEvent): void => {
      dragging = true
      control.setPointerCapture(e.pointerId)
      sendGlobal({
        type: 'slider',
        msg: { type: 'setThumb', index: 0, value: computeValue(e.clientX) },
      })
    }
    const onMove = (e: PointerEvent): void => {
      if (!dragging) return
      sendGlobal({
        type: 'slider',
        msg: { type: 'setThumb', index: 0, value: computeValue(e.clientX) },
      })
    }
    const onUp = (e: PointerEvent): void => {
      dragging = false
      if (control.hasPointerCapture(e.pointerId)) control.releasePointerCapture(e.pointerId)
    }

    control.addEventListener('pointerdown', onDown)
    control.addEventListener('pointermove', onMove)
    control.addEventListener('pointerup', onUp)
    control.addEventListener('pointercancel', onUp)

    return () => {
      control.removeEventListener('pointerdown', onDown)
      control.removeEventListener('pointermove', onMove)
      control.removeEventListener('pointerup', onUp)
      control.removeEventListener('pointercancel', onUp)
    }
  })

  return div({ class: 'demo-section' }, [
    h2({ class: 'demo-title' }, [text('Slider')]),
    div({ ...sliderParts.root, class: 'relative' }, [
      div({ ...sliderParts.control }, [
        div({ ...sliderParts.track }, [div({ ...sliderParts.range }, [])]),
        div({ ...sliderParts.thumb(0).thumb }, []),
      ]),
    ]),
    div({ class: 'mt-2 text-sm text-slate-600' }, [
      text('Value: '),
      text((s: State) => String(s.slider.value[0] ?? 0)),
    ]),
  ])
}

function selectSection(): Node {
  return div({ class: 'demo-section' }, [
    h2({ class: 'demo-title' }, [text('Select')]),
    button({ ...selectParts.trigger }, [
      span({}, [text((s: State) => selectParts.valueText(s))]),
      span({ class: 'ml-2 text-slate-400' }, [text('▾')]),
    ]),
    ...select.overlay<State>({
      get: (s) => s.select,
      send: (m) => sendGlobal({ type: 'select', msg: m }),
      parts: selectParts,
      content: () => [div({ ...selectParts.content }, renderSelectItems())],
    }),
  ])
}

function renderSelectItems(): Node[] {
  // Demo uses a static item list — render each with its select-item part
  const items = ['Red', 'Green', 'Blue', 'Purple', 'Orange']
  return items.map((item, i) => {
    const partItem = selectParts.item(item, i).item
    return div({ ...partItem }, [text(item)])
  })
}

function popoverSection(send: (m: Msg) => void): Node {
  return div({ class: 'demo-section' }, [
    h2({ class: 'demo-title' }, [text('Popover')]),
    button({ ...popoverParts.trigger, class: 'btn btn-primary' }, [text('Show info')]),
    ...popover.overlay<State>({
      get: (s) => s.popover,
      send: (m) => send({ type: 'popover', msg: m }),
      parts: popoverParts,
      content: () => [
        div(
          {
            ...popoverParts.content,
            class: 'min-w-[16rem] rounded-md border border-slate-200 bg-white p-4 shadow-lg',
          },
          [
            h3({ ...popoverParts.title, class: 'text-sm font-semibold' }, [text('Did you know?')]),
            p({ class: 'mt-1 text-xs text-slate-600' }, [
              text('LLui compiles access patterns into bitmasks at build time.'),
            ]),
            button({ ...popoverParts.closeTrigger, class: 'btn btn-secondary mt-3 text-xs' }, [
              text('Got it'),
            ]),
          ],
        ),
      ],
      placement: 'bottom-start',
    }),
  ])
}

function menuSection(): Node {
  return div({ class: 'demo-section' }, [
    h2({ class: 'demo-title' }, [text('Menu')]),
    button({ ...menuParts.trigger, class: 'btn btn-secondary' }, [text('Actions ▾')]),
    ...menu.overlay<State>({
      get: (s) => s.menu,
      send: (m) => sendGlobal({ type: 'menu', msg: m }),
      parts: menuParts,
      content: () => [div({ ...menuParts.content }, [...renderMenuItems()])],
    }),
  ])
}

function renderMenuItems(): Node[] {
  const items = ['Edit', 'Duplicate', 'Archive', 'Delete']
  return items.map((v) => {
    const itemPart = menuParts.item(v).item
    return div({ ...itemPart }, [text(v)])
  })
}

function toastSection(send: (m: Msg) => void): Node {
  return div({ class: 'demo-section' }, [
    h2({ class: 'demo-title' }, [text('Toast')]),
    div({ class: 'flex gap-2' }, [
      button(
        {
          class: 'btn btn-secondary text-xs',
          onClick: () => send({ type: 'emitToast', kind: 'info' }),
        },
        [text('Info')],
      ),
      button(
        {
          class: 'btn btn-primary text-xs',
          onClick: () => send({ type: 'emitToast', kind: 'success' }),
        },
        [text('Success')],
      ),
      button(
        {
          class: 'btn btn-danger text-xs',
          onClick: () => send({ type: 'emitToast', kind: 'error' }),
        },
        [text('Error')],
      ),
    ]),
  ])
}

function confirmSection(send: (m: Msg) => void): Node {
  return div({ class: 'demo-section' }, [
    h2({ class: 'demo-title' }, [text('Confirm Dialog')]),
    p({ class: 'mb-3 text-sm text-slate-600' }, [
      text('Last action: '),
      span({ class: 'font-medium' }, [text((s: State) => s.message || 'none')]),
    ]),
    button({ class: 'btn btn-danger', onClick: () => send({ type: 'askConfirm' }) }, [
      text('Delete item…'),
    ]),
  ])
}

function tabsSection(): Node {
  return div({ class: 'demo-section' }, [
    h2({ class: 'demo-title' }, [text('Tabs')]),
    div({ ...tabsParts.root }, [
      div({ ...tabsParts.list }, [
        button({ ...tabsParts.item('overview').trigger }, [text('Overview')]),
        button({ ...tabsParts.item('specs').trigger }, [text('Specs')]),
        button({ ...tabsParts.item('reviews').trigger }, [text('Reviews')]),
      ]),
      div({ ...tabsParts.item('overview').panel, class: 'py-3 text-sm' }, [
        text('This is the overview tab. Tabs use automatic activation by default.'),
      ]),
      div({ ...tabsParts.item('specs').panel, class: 'py-3 text-sm' }, [
        text('Technical specifications panel. Arrow keys navigate between tabs.'),
      ]),
      div({ ...tabsParts.item('reviews').panel, class: 'py-3 text-sm' }, [
        text('Customer reviews go here.'),
      ]),
    ]),
  ])
}

function accordionSection(): Node {
  return div({ class: 'demo-section' }, [
    h2({ class: 'demo-title' }, [text('Accordion')]),
    div({ ...accordionParts.root }, [
      accordionItem(
        'what',
        'What is LLui?',
        'A compile-time-optimized web framework built on The Elm Architecture with zero virtual DOM.',
      ),
      accordionItem(
        'why',
        'Why another framework?',
        'LLui is designed for LLM-first authoring — clean TEA patterns, explicit data flow, and a compiler that does the heavy lifting.',
      ),
      accordionItem(
        'how',
        'How does it work?',
        'The Vite plugin extracts state access paths at build time, assigns bitmask bits, and synthesizes dirty-check functions for zero runtime overhead.',
      ),
    ]),
  ])
}

function accordionItem(value: string, title: string, body: string): Node {
  const parts = accordionParts.item(value)
  return div({ ...parts.item }, [
    h3({}, [
      button({ ...parts.trigger }, [
        span({}, [text(title)]),
        span(
          {
            class: 'ml-2 transition-transform',
            'data-state': (s: State) => (s.accordion.value.includes(value) ? 'open' : 'closed'),
            style: (s: State) =>
              s.accordion.value.includes(value) ? 'transform:rotate(180deg);' : '',
          },
          [text('▾')],
        ),
      ]),
    ]),
    div({ ...parts.content }, [text(body)]),
  ])
}

function toastRegion(): Node[] {
  type Toast = { id: string; type: string; title?: string; description?: string }
  return [
    div(
      { ...toastParts.region },
      each<State, Toast, ToasterMsg>({
        items: (s) => s.toast.toasts,
        key: (t) => t.id,
        render: ({ item }) => [
          div(
            {
              'data-scope': 'toast',
              'data-part': 'root',
              'data-type': item.type,
            },
            [
              div({ 'data-scope': 'toast', 'data-part': 'title' }, [
                text(() => item.title() ?? ''),
              ]),
              div({ 'data-scope': 'toast', 'data-part': 'description' }, [
                text(() => item.description() ?? ''),
              ]),
            ],
          ),
        ],
      }),
    ),
  ]
}

function confirmDialogOverlay(send: (m: Msg) => void): Node[] {
  return confirmDialog.view<State>({
    get: (s) => s.confirm,
    send: (m) => send({ type: 'confirm', msg: m }),
    id: 'confirm-dialog',
  })
}

// ── New sections ────────────────────────────────────────────────────────────

function checkboxSection(): Node {
  return div({ class: 'demo-section' }, [
    h2({ class: 'demo-title' }, [text('Checkbox')]),
    label({ class: 'flex items-center gap-3' }, [
      div({ ...checkboxParts.root, class: 'cb' }, [
        span({ ...checkboxParts.indicator, class: 'cb__indicator' }, [
          text((s: State) => {
            const c = s.checkbox.checked
            return c === true ? '✓' : c === 'indeterminate' ? '−' : ''
          }),
        ]),
      ]),
      span({ class: 'text-sm' }, [
        text((s: State) => {
          const c = s.checkbox.checked
          return c === true ? 'Checked' : c === 'indeterminate' ? 'Indeterminate' : 'Unchecked'
        }),
      ]),
    ]),
    div({ class: 'mt-3 flex gap-2' }, [
      button(
        {
          class: 'btn btn-secondary text-xs',
          onClick: () =>
            sendGlobal({ type: 'checkbox', msg: { type: 'setChecked', checked: 'indeterminate' } }),
        },
        [text('Set indeterminate')],
      ),
    ]),
  ])
}

function radioSection(): Node {
  return div({ class: 'demo-section' }, [
    h2({ class: 'demo-title' }, [text('Radio Group')]),
    div({ ...radioParts.root, class: 'flex flex-col gap-2' }, [
      radioItem('small', 'Small'),
      radioItem('medium', 'Medium'),
      radioItem('large', 'Large'),
    ]),
    div({ class: 'mt-3 text-sm text-slate-600' }, [
      text('Size: '),
      text((s: State) => s.radio.value ?? 'none'),
    ]),
  ])
}

function radioItem(value: string, labelText: string): Node {
  const parts = radioParts.item(value)
  return label({ class: 'flex items-center gap-2 cursor-pointer' }, [
    div({ ...parts.root, class: 'radio' }, [
      div({ ...parts.indicator, class: 'radio__indicator' }, []),
    ]),
    span({ class: 'text-sm' }, [text(labelText)]),
  ])
}

function toggleGroupSection(): Node {
  return div({ class: 'demo-section' }, [
    h2({ class: 'demo-title' }, [text('Toggle Group')]),
    div(
      {
        ...togGroupParts.root,
        class: 'inline-flex rounded-md border border-slate-300 overflow-hidden',
      },
      [togItem('bold', 'B'), togItem('italic', 'I'), togItem('underline', 'U')],
    ),
    div({ class: 'mt-3 text-sm text-slate-600' }, [
      text('Active: '),
      text((s: State) => (s.togGroup.value.length > 0 ? s.togGroup.value.join(', ') : 'none')),
    ]),
  ])
}

function togItem(value: string, labelText: string): Node {
  return button({ ...togGroupParts.item(value).root, class: 'tg-item' }, [text(labelText)])
}

function numberSection(): Node {
  return div({ class: 'demo-section' }, [
    h2({ class: 'demo-title' }, [text('Number Input')]),
    div({ ...numberParts.root, class: 'num-root' }, [
      button({ ...numberParts.decrement, class: 'num-btn' }, [text('−')]),
      input({ ...numberParts.input, class: 'num-input' }),
      button({ ...numberParts.increment, class: 'num-btn' }, [text('+')]),
    ]),
    div({ class: 'mt-3 text-sm text-slate-600' }, [
      text('Quantity: '),
      text((s: State) => String(s.number.value ?? 0)),
    ]),
  ])
}

function passwordSection(): Node {
  return div({ class: 'demo-section' }, [
    h2({ class: 'demo-title' }, [text('Password Input')]),
    div({ ...passwordParts.root, class: 'pw-root' }, [
      input({ ...passwordParts.input, class: 'pw-input' }),
      button({ ...passwordParts.visibilityTrigger, class: 'pw-toggle' }, [
        text((s: State) => (s.password.visible ? 'Hide' : 'Show')),
      ]),
    ]),
  ])
}

function ratingSection(): Node {
  return div({ class: 'demo-section' }, [
    h2({ class: 'demo-title' }, [text('Rating')]),
    div({ ...ratingParts.root, class: 'rating' }, [
      ratingStar(0),
      ratingStar(1),
      ratingStar(2),
      ratingStar(3),
      ratingStar(4),
    ]),
    div({ class: 'mt-3 text-sm text-slate-600' }, [
      text('Rating: '),
      text((s: State) => String(s.rating.value)),
      text(' / '),
      text((s: State) => String(s.rating.count)),
    ]),
  ])
}

function ratingStar(index: number): Node {
  return div({ ...ratingParts.item(index).root, class: 'rating-star' }, [text('★')])
}

function paginationSection(): Node {
  return div({ class: 'demo-section' }, [
    h2({ class: 'demo-title' }, [text('Pagination')]),
    div({ ...paginationParts.root, class: 'flex items-center gap-1' }, [
      button({ ...paginationParts.prevTrigger, class: 'pg-btn' }, [text('‹')]),
      paginationItem(1),
      paginationItem(2),
      paginationItem(3),
      paginationItem(4),
      paginationItem(5),
      span({ class: 'px-2 text-slate-400' }, [text('…')]),
      paginationItem(10),
      button({ ...paginationParts.nextTrigger, class: 'pg-btn' }, [text('›')]),
    ]),
    div({ class: 'mt-3 text-sm text-slate-600' }, [
      text('Page '),
      text((s: State) => String(s.pagination.page)),
      text(' of '),
      text((s: State) => String(Math.ceil(s.pagination.total / s.pagination.pageSize))),
    ]),
  ])
}

function paginationItem(page: number): Node {
  return button({ ...paginationParts.item(page), class: 'pg-btn' }, [text(String(page))])
}

function avatarSection(): Node {
  return div({ class: 'demo-section' }, [
    h2({ class: 'demo-title' }, [text('Avatar')]),
    div({ class: 'flex items-center gap-4' }, [
      div({ ...avatarParts.root, class: 'avatar' }, [
        // Intentionally broken URL to show fallback
        img({
          ...avatarParts.image,
          src: 'https://example.invalid/not-an-avatar.png',
          alt: '',
          class: 'avatar__image',
        }),
        span({ ...avatarParts.fallback, class: 'avatar__fallback' }, [text('FP')]),
      ]),
      div({ class: 'text-sm text-slate-600' }, [
        text('Status: '),
        text((s: State) => s.avatar.status),
      ]),
    ]),
  ])
}

function tooltipSection(): Node {
  return div({ class: 'demo-section' }, [
    h2({ class: 'demo-title' }, [text('Tooltip')]),
    button({ ...tooltipParts.trigger, class: 'btn btn-secondary' }, [text('Hover me')]),
    ...tooltip.overlay<State>({
      get: (s) => s.tooltip,
      send: (m) => sendGlobal({ type: 'tooltip', msg: m }),
      parts: tooltipParts,
      content: () => [div({ ...tooltipParts.content, class: 'tip' }, [text('This is a tooltip')])],
    }),
  ])
}

function hoverCardSection(): Node {
  return div({ class: 'demo-section' }, [
    h2({ class: 'demo-title' }, [text('Hover Card')]),
    span({ ...hoverCardParts.trigger, class: 'underline decoration-dotted cursor-pointer' }, [
      text('Hover for details'),
    ]),
    ...hoverCard.overlay<State>({
      get: (s) => s.hoverCard,
      send: (m) => sendGlobal({ type: 'hoverCard', msg: m }),
      parts: hoverCardParts,
      content: () => [
        div({ ...hoverCardParts.content, class: 'hc' }, [
          h3({ class: 'text-sm font-semibold' }, [text('LLui Components')]),
          p({ class: 'mt-1 text-xs text-slate-600' }, [
            text('Headless state machines with full keyboard, screen-reader, and pointer support.'),
          ]),
        ]),
      ],
    }),
  ])
}

function comboboxSection(): Node {
  return div({ class: 'demo-section' }, [
    h2({ class: 'demo-title' }, [text('Combobox')]),
    div({ ...comboboxParts.root, class: 'relative' }, [
      input({ ...comboboxParts.input, class: 'cb-input', placeholder: 'Search fruits…' }),
    ]),
    ...combobox.overlay<State>({
      get: (s) => s.combobox,
      send: (m) => sendGlobal({ type: 'combobox', msg: m }),
      parts: comboboxParts,
      content: () => [
        div(
          { ...comboboxParts.content, class: 'cb-content' },
          each<State, string, ComboboxMsg>({
            items: (s) => s.combobox.filteredItems,
            key: (v) => v,
            render: ({ item, index }) => {
              // Read the item's current value + index at mount — the cell part
              // is constructed from those. When filter changes, each reconciles
              // by key (value). Items that remain keep their DOM; new matches
              // get fresh rows.
              const value = item((t: string) => t)()
              const idx = index()
              const parts = comboboxParts.item(value, idx).item
              return [div({ ...parts, class: 'cb-item' }, [text(value)])]
            },
          }),
        ),
      ],
    }),
    div({ class: 'mt-3 text-sm text-slate-600' }, [
      text('Selected: '),
      text((s: State) => s.combobox.value[0] ?? 'none'),
    ]),
  ])
}

function drawerSection(send: (m: Msg) => void): Node {
  return div({ class: 'demo-section' }, [
    h2({ class: 'demo-title' }, [text('Drawer')]),
    button({ ...drawerParts.trigger, class: 'btn btn-primary' }, [text('Open drawer')]),
  ])
  void send
}

function drawerOverlay(send: (m: Msg) => void): Node[] {
  return drawer.overlay<State>({
    get: (s) => s.drawer,
    send: (m) => send({ type: 'drawer', msg: m }),
    parts: drawerParts,
    content: () => [
      div({ ...drawerParts.content, class: 'drawer-content' }, [
        h3({ ...drawerParts.title, class: 'text-lg font-semibold' }, [text('Drawer panel')]),
        p({ class: 'mt-2 text-sm text-slate-600' }, [
          text('Slide-in panel with focus trap, scroll lock, and dismissable layer.'),
        ]),
        button({ ...drawerParts.closeTrigger, class: 'btn btn-secondary mt-4' }, [text('Close')]),
      ]),
    ],
  })
}

// ── Batch 3 sections ────────────────────────────────────────────────────────

function pinInputSection(): Node {
  // Auto-advance keyboard focus after each character entry.
  onMount(() => {
    const inputs = document.querySelectorAll<HTMLInputElement>(
      '[data-scope="pin-input"][data-part="input"]',
    )
    const handleInput = (e: Event): void => {
      const el = e.target as HTMLInputElement
      if (el.value.length > 0) {
        const idx = parseInt(el.dataset.index ?? '0', 10)
        inputs[idx + 1]?.focus()
      }
    }
    inputs.forEach((el) => el.addEventListener('input', handleInput))
    return () => inputs.forEach((el) => el.removeEventListener('input', handleInput))
  })

  return div({ class: 'demo-section' }, [
    h2({ class: 'demo-title' }, [text('Pin Input (OTP)')]),
    div({ ...pinInputParts.root, class: 'flex gap-2' }, [
      div({ ...pinInputParts.label, class: 'sr-only' }, [text('Verification code')]),
      input({ ...pinInputParts.input(0), class: 'pin-slot' }),
      input({ ...pinInputParts.input(1), class: 'pin-slot' }),
      input({ ...pinInputParts.input(2), class: 'pin-slot' }),
      input({ ...pinInputParts.input(3), class: 'pin-slot' }),
    ]),
    div({ class: 'mt-3 text-sm text-slate-600' }, [
      text('Code: '),
      text((s: State) => s.pinInput.values.join('') || '(empty)'),
    ]),
  ])
}

function tagsInputSection(): Node {
  return div({ class: 'demo-section' }, [
    h2({ class: 'demo-title' }, [text('Tags Input')]),
    div({ ...tagsInputParts.root, class: 'tags-root' }, [
      div({ class: 'tags-list' }, [
        ...each<State, string, TagsInputMsg>({
          items: (s) => s.tagsInput.value,
          key: (t) => t,
          render: ({ item, index }) => {
            const tagFn = item((t) => t)
            return [
              span({ class: 'tag' }, [
                text(tagFn),
                button(
                  {
                    type: 'button',
                    class: 'tag-x',
                    onClick: () =>
                      sendGlobal({ type: 'tagsInput', msg: { type: 'removeTag', index: index() } }),
                    'aria-label': 'Remove tag',
                  },
                  [text('×')],
                ),
              ]),
            ]
          },
        }),
      ]),
      input({ ...tagsInputParts.input, class: 'tags-input', placeholder: 'Enter to add' }),
    ]),
  ])
}

function stepperSection(): Node {
  return div({ class: 'demo-section' }, [
    h2({ class: 'demo-title' }, [text('Stepper')]),
    div({ ...stepperParts.root, class: 'step-root' }, [
      stepItem(0, 'Account'),
      stepItem(1, 'Profile'),
      stepItem(2, 'Review'),
    ]),
    div({ class: 'mt-3 flex gap-2' }, [
      button({ ...stepperParts.prevTrigger, class: 'btn btn-secondary text-xs' }, [text('Back')]),
      button({ ...stepperParts.nextTrigger, class: 'btn btn-primary text-xs' }, [text('Next')]),
    ]),
  ])
}

function stepItem(index: number, labelText: string): Node {
  const parts = stepperParts.item(index)
  // Always render the separator; last step's sep is hidden via CSS :last-child.
  return div({ ...parts.item, class: 'step-item' }, [
    button({ ...parts.trigger, class: 'step-btn' }, [text(String(index + 1))]),
    span({ class: 'step-label' }, [text(labelText)]),
    span({ ...parts.separator, class: 'step-sep' }, []),
  ])
}

function carouselSection(): Node {
  const slides = ['Mountains', 'Ocean', 'Forest', 'Desert']
  const colors = ['#0891b2', '#0284c7', '#166534', '#d97706']
  const renderSlides = (): Node[] =>
    slides.map((s, i) =>
      div(
        {
          ...carouselParts.slide(i).slide,
          class: 'carousel-slide',
          style: `background:${colors[i]}`,
        },
        [text(s)],
      ),
    )
  const renderIndicators = (): Node[] =>
    slides.map((_, i) =>
      button({ ...carouselParts.slide(i).indicator, class: 'carousel-dot' }, []),
    )
  return div({ class: 'demo-section' }, [
    h2({ class: 'demo-title' }, [text('Carousel')]),
    div({ ...carouselParts.root, class: 'carousel' }, [
      div({ ...carouselParts.viewport, class: 'carousel-viewport' }, renderSlides()),
      div({ class: 'carousel-controls' }, [
        button({ ...carouselParts.prevTrigger, class: 'btn btn-secondary text-xs' }, [text('‹')]),
        div({ ...carouselParts.indicatorGroup, class: 'carousel-indicators' }, renderIndicators()),
        button({ ...carouselParts.nextTrigger, class: 'btn btn-secondary text-xs' }, [text('›')]),
      ]),
    ]),
  ])
}

function datePickerSection(): Node {
  return div({ class: 'demo-section' }, [
    h2({ class: 'demo-title' }, [text('Date Picker')]),
    div({ ...datePickerParts.root, class: 'datepicker' }, [
      div({ class: 'dp-header' }, [
        button({ ...datePickerParts.prevMonthTrigger, class: 'dp-nav' }, [text('‹')]),
        span({ class: 'dp-title' }, [
          text((s: State) => {
            const months = [
              'Jan',
              'Feb',
              'Mar',
              'Apr',
              'May',
              'Jun',
              'Jul',
              'Aug',
              'Sep',
              'Oct',
              'Nov',
              'Dec',
            ]
            return `${months[s.datePicker.visibleMonth - 1]} ${s.datePicker.visibleYear}`
          }),
        ]),
        button({ ...datePickerParts.nextMonthTrigger, class: 'dp-nav' }, [text('›')]),
      ]),
      div({ ...datePickerParts.grid, class: 'dp-grid' }, renderCalendarDays()),
    ]),
    div({ class: 'mt-3 text-sm text-slate-600' }, [
      text('Selected: '),
      text((s: State) => s.datePicker.value ?? 'none'),
    ]),
  ])
}

function renderCalendarDays(): Node[] {
  const dowLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const dowCells = dowLabels.map((d) => span({ class: 'dp-dow' }, [text(d)]))
  // Grid is computed reactively: monthGrid(state.datePicker) returns a fresh
  // array keyed on `iso`. When visibleMonth/Year changes, keys change →
  // entries rebuild. When just the focused or value changes, keys stay the
  // same but the per-cell data-* accessors re-evaluate against state.
  const gridCells = each<State, DayCell, DatePickerMsg>({
    items: (s) => monthGrid(s.datePicker),
    key: (cell) => cell.iso,
    render: ({ item }) => {
      // Stable per entry — computed once on mount.
      const iso = item((c: DayCell) => c.iso)()
      const day = item((c: DayCell) => c.day)()
      const inMonth = item((c: DayCell) => c.inMonth)()
      return [
        button(
          {
            role: 'gridcell',
            'data-date': iso,
            'data-in-month': inMonth ? '' : undefined,
            'data-today': (s: State) => (iso === todayIsoString() ? '' : undefined),
            'data-selected': (s: State) => (s.datePicker.value === iso ? '' : undefined),
            'data-focused': (s: State) => (s.datePicker.focused === iso ? '' : undefined),
            'aria-selected': (s: State) => s.datePicker.value === iso,
            tabIndex: (s: State) => (s.datePicker.focused === iso ? 0 : -1),
            class: 'dp-day',
            onClick: () => {
              sendGlobal({ type: 'datePicker', msg: { type: 'setFocused', date: iso } })
              sendGlobal({ type: 'datePicker', msg: { type: 'selectFocused' } })
            },
          },
          [text(String(day))],
        ),
      ]
    },
  })
  return [...dowCells, ...gridCells]
}

function todayIsoString(): string {
  const d = new Date()
  const pad = (n: number): string => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function timePickerSection(): Node {
  return div({ class: 'demo-section' }, [
    h2({ class: 'demo-title' }, [text('Time Picker')]),
    div({ ...timePickerParts.root, class: 'tp-root' }, [
      input({ ...timePickerParts.hoursInput, class: 'tp-input' }),
      span({ class: 'tp-sep' }, [text(':')]),
      input({ ...timePickerParts.minutesInput, class: 'tp-input' }),
      button({ ...timePickerParts.periodTrigger, class: 'tp-period' }, [
        text((s: State) => (s.timePicker.value.hours >= 12 ? 'PM' : 'AM')),
      ]),
    ]),
    div({ class: 'mt-3 text-sm text-slate-600' }, [
      text('Time: '),
      text((s: State) => formatTime(s.timePicker)),
    ]),
  ])
}

function colorPickerSection(): Node {
  return div({ class: 'demo-section' }, [
    h2({ class: 'demo-title' }, [text('Color Picker')]),
    div({ ...colorPickerParts.root, class: 'cp-root' }, [
      div({ class: 'cp-row' }, [
        div({ ...colorPickerParts.swatch, class: 'cp-swatch' }, []),
        input({ ...colorPickerParts.hexInput, class: 'cp-hex' }),
      ]),
      div({ class: 'cp-sliders' }, [
        label({ class: 'cp-label' }, [
          span({}, [text('H')]),
          input({ ...colorPickerParts.hueSlider, class: 'cp-range' }),
        ]),
        label({ class: 'cp-label' }, [
          span({}, [text('S')]),
          input({ ...colorPickerParts.saturationSlider, class: 'cp-range' }),
        ]),
        label({ class: 'cp-label' }, [
          span({}, [text('L')]),
          input({ ...colorPickerParts.lightnessSlider, class: 'cp-range' }),
        ]),
      ]),
    ]),
  ])
}

function clipboardSection(_send: (m: Msg) => void): Node {
  return div({ class: 'demo-section' }, [
    h2({ class: 'demo-title' }, [text('Clipboard')]),
    div({ ...clipboardParts.root, class: 'clip-root' }, [
      input({ ...clipboardParts.input, class: 'clip-input' }),
      button(
        {
          ...clipboardParts.trigger,
          class: 'btn btn-secondary text-xs',
          onClick: (e: MouseEvent) => {
            const root = (e.currentTarget as HTMLElement).closest(
              '[data-scope="clipboard"][data-part="root"]',
            )
            const inp = root?.querySelector<HTMLInputElement>('[data-part="input"]')
            sendGlobal({ type: 'copyText', value: inp?.value ?? '' })
          },
        },
        [text((s: State) => (s.clipboard.copied ? 'Copied!' : 'Copy'))],
      ),
    ]),
  ])
}

function editableSection(_send: (m: Msg) => void): Node {
  // Focus + select the input whenever we enter edit mode. We watch the
  // editing flag via a derived text binding side-effect isn't LLui-idiomatic,
  // so instead override preview onClick to dispatch then focus in a microtask.
  const previewParts = { ...editableParts.preview }
  const originalClick = previewParts.onClick
  previewParts.onClick = (e: MouseEvent) => {
    originalClick(e)
    queueMicrotask(() => {
      const inp = document.querySelector<HTMLInputElement>('.editable-input')
      inp?.focus()
      inp?.select()
    })
  }

  return div({ class: 'demo-section' }, [
    h2({ class: 'demo-title' }, [text('Editable')]),
    div({ ...editableParts.root, class: 'editable' }, [
      span({ ...previewParts, class: 'editable-preview' }, [
        text((s: State) => s.editable.value || 'Click to edit'),
      ]),
      input({ ...editableParts.input, class: 'editable-input' }),
    ]),
    div({ class: 'mt-2 text-xs text-slate-500' }, [
      text('Click, edit, press Enter to commit or Esc to cancel'),
    ]),
  ])
}

function fileUploadSection(): Node {
  return div({ class: 'demo-section' }, [
    h2({ class: 'demo-title' }, [text('File Upload')]),
    div({ ...fileUploadParts.root, class: 'fu-root' }, [
      div({ ...fileUploadParts.dropzone, class: 'fu-dropzone' }, [
        text('Drag files here or '),
        button({ ...fileUploadParts.trigger, class: 'fu-browse' }, [text('browse')]),
        input({ ...fileUploadParts.hiddenInput }),
      ]),
      div({ class: 'fu-list' }, [
        ...each<State, File, FileUploadMsg>({
          items: (s) => s.fileUpload.files,
          key: (f) => f.name,
          render: ({ item }) => [
            div({ class: 'fu-item' }, [
              text(() => item.name()),
              text(' ('),
              text(() => `${Math.round(item.size() / 1024)}kb`),
              text(')'),
            ]),
          ],
        }),
      ]),
    ]),
  ])
}

function splitterSection(): Node {
  // Pointer drag: capture pointerdown on the handle, then track pointermove
  // on the window until pointerup. Compute % position from cursor relative to
  // the root's bounding rect.
  onMount(() => {
    const root = document.querySelector<HTMLElement>('[data-scope="splitter"][data-part="root"]')
    const handle = document.querySelector<HTMLElement>(
      '[data-scope="splitter"][data-part="resize-trigger"]',
    )
    if (!root || !handle) return
    let dragging = false
    const computePct = (clientX: number): number => {
      const rect = root.getBoundingClientRect()
      const pct = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100))
      return Math.round(pct)
    }
    const onDown = (e: PointerEvent): void => {
      dragging = true
      handle.setPointerCapture(e.pointerId)
      sendGlobal({ type: 'splitter', msg: { type: 'startDrag' } })
      sendGlobal({ type: 'splitter', msg: { type: 'setPosition', position: computePct(e.clientX) } })
    }
    const onMove = (e: PointerEvent): void => {
      if (!dragging) return
      sendGlobal({ type: 'splitter', msg: { type: 'setPosition', position: computePct(e.clientX) } })
    }
    const onUp = (e: PointerEvent): void => {
      if (!dragging) return
      dragging = false
      if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId)
      sendGlobal({ type: 'splitter', msg: { type: 'endDrag' } })
    }
    handle.addEventListener('pointerdown', onDown)
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
    handle.addEventListener('pointercancel', onUp)
    return () => {
      handle.removeEventListener('pointerdown', onDown)
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      handle.removeEventListener('pointercancel', onUp)
    }
  })

  return div({ class: 'demo-section' }, [
    h2({ class: 'demo-title' }, [text('Splitter')]),
    div({ ...splitterParts.root, class: 'split-root' }, [
      div({ ...splitterParts.primaryPanel, class: 'split-pane' }, [text('Left pane')]),
      div({ ...splitterParts.resizeTrigger, class: 'split-handle' }, []),
      div({ ...splitterParts.secondaryPanel, class: 'split-pane' }, [text('Right pane')]),
    ]),
    div({ class: 'mt-2 text-xs text-slate-500' }, [
      text('Drag handle or use arrow keys when focused — split at '),
      text((s: State) => `${s.splitter.position}%`),
    ]),
  ])
}

function treeViewSection(): Node {
  return div({ class: 'demo-section' }, [
    h2({ class: 'demo-title' }, [text('Tree View')]),
    div({ ...treeViewParts.root, class: 'tree' }, [
      treeBranch('root', 'project/', 0, [
        treeLeaf('docs', 'docs/', 1),
        treeBranch('src', 'src/', 1, [
          treeLeaf('main.ts', 'main.ts', 2),
          treeLeaf('utils.ts', 'utils.ts', 2),
        ]),
        treeLeaf('tests', 'tests/', 1),
      ]),
    ]),
  ])
}

function treeBranch(id: string, labelText: string, depth: number, children: Node[]): Node {
  const parts = treeViewParts.item(id, depth, true)
  return div({}, [
    div({ ...parts.item, class: 'tree-item' }, [
      button({ ...parts.branchTrigger, class: 'tree-caret' }, [text('▸')]),
      span({ class: 'tree-label' }, [text(labelText)]),
    ]),
    div(
      {
        class: 'tree-children',
        hidden: (s: State) => !s.treeView.expanded.includes(id),
      },
      children,
    ),
  ])
}

function treeLeaf(id: string, label: string, depth: number): Node {
  const parts = treeViewParts.item(id, depth, false)
  return div({ ...parts.item, class: 'tree-item tree-leaf' }, [
    span({ class: 'tree-label' }, [text(label)]),
  ])
}

function contextMenuSection(): Node {
  return div({ class: 'demo-section' }, [
    h2({ class: 'demo-title' }, [text('Context Menu')]),
    div({ ...contextMenuParts.trigger, class: 'ctx-target' }, [text('Right-click me')]),
  ])
}

function contextMenuOverlay(send: (m: Msg) => void): Node[] {
  const items = ['Cut', 'Copy', 'Paste', 'Delete']
  const renderItems = (): Node[] =>
    items.map((v) => div({ ...contextMenuParts.item(v).item, class: 'ctx-menu-item' }, [text(v)]))
  return contextMenu.overlay<State>({
    get: (s) => s.contextMenu,
    send: (m) => send({ type: 'contextMenu', msg: m }),
    parts: contextMenuParts,
    content: () => [div({ ...contextMenuParts.content, class: 'ctx-menu' }, renderItems())],
  })
}

mountApp(document.getElementById('app')!, Demo)
