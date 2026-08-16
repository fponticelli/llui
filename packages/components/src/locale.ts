import type { Context } from '@llui/dom'
import { enCarousel } from './locale/carousel.js'
import { enCascadeSelect } from './locale/cascade-select.js'
import { enClipboard } from './locale/clipboard.js'
import { enColorPicker } from './locale/color-picker.js'
import { enCombobox } from './locale/combobox.js'
import { ComponentLocaleContext, type Locale } from './locale/context.js'
import { enDateInput } from './locale/date-input.js'
import { enDatePicker } from './locale/date-picker.js'
import { enDialog } from './locale/dialog.js'
import { enDrawer } from './locale/drawer.js'
import { enFileUpload } from './locale/file-upload.js'
import { enFloatingPanel } from './locale/floating-panel.js'
import { enImageCropper } from './locale/image-cropper.js'
import { enNavigationMenu } from './locale/navigation-menu.js'
import { enNumberInput } from './locale/number-input.js'
import { enPagination } from './locale/pagination.js'
import { enPasswordInput } from './locale/password-input.js'
import { enPinInput } from './locale/pin-input.js'
import { enPopover } from './locale/popover.js'
import { enProgress } from './locale/progress.js'
import { enQrCode } from './locale/qr-code.js'
import { enSignaturePad } from './locale/signature-pad.js'
import { enSortable } from './locale/sortable.js'
import { enSteps } from './locale/steps.js'
import { enTagsInput } from './locale/tags-input.js'
import { enTimePicker } from './locale/time-picker.js'
import { enTimer } from './locale/timer.js'
import { enToast } from './locale/toast.js'
import { enToc } from './locale/toc.js'
import { enTour } from './locale/tour.js'

export type { Locale } from './locale/context.js'

/** English locale — used as the default when no provider is in the tree. */
export const en: Locale = {
  direction: 'ltr',
  carousel: enCarousel,
  cascadeSelect: enCascadeSelect,
  clipboard: enClipboard,
  colorPicker: enColorPicker,
  combobox: enCombobox,
  dateInput: enDateInput,
  datePicker: enDatePicker,
  dialog: enDialog,
  drawer: enDrawer,
  fileUpload: enFileUpload,
  floatingPanel: enFloatingPanel,
  imageCropper: enImageCropper,
  navigationMenu: enNavigationMenu,
  numberInput: enNumberInput,
  pagination: enPagination,
  passwordInput: enPasswordInput,
  pinInput: enPinInput,
  popover: enPopover,
  progress: enProgress,
  qrCode: enQrCode,
  signaturePad: enSignaturePad,
  sortable: enSortable,
  steps: enSteps,
  tagsInput: enTagsInput,
  timePicker: enTimePicker,
  timer: enTimer,
  toast: enToast,
  toc: enToc,
  tour: enTour,
}

/**
 * Locale context. Components resolve their own English fallback so component
 * subpath bundles only carry that component's strings. This public context and
 * the lightweight component context share an id, preserving `provide()`
 * behavior while retaining the complete English locale as the public default.
 */
export const LocaleContext: Context<Locale> = {
  id: ComponentLocaleContext.id,
  default: en,
}
