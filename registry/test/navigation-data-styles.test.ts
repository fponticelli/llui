import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { component, div, mountApp, path, svg, text } from '@llui/dom'
import { chromium, type Browser } from 'playwright'
import * as carouselMachine from '../../packages/components/src/components/carousel'
import { read, rootSignal } from '../../packages/components/test/_signal'
import {
  probeDarkStateHierarchy,
  probeEffectiveMotion,
  probeForcedColorCues,
  probeNarrowProduct,
  type NarrowProbe,
} from '../../packages/components/test/styles/navigation-data-browser-probes'
import {
  paintedColors,
  selfCheckPixelHarness,
} from '../../packages/components/test/styles/pixel-probe'
import { contrast, srgb8ToLinear } from '../../scripts/lib/oklch.mjs'
import { compileCandidates, markerName } from '../../scripts/lib/tailwind-compile.mjs'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../llui/ui/accordion'
import { Alert, AlertDescription, AlertTitle } from '../llui/ui/alert'
import { Avatar, AvatarFallback } from '../llui/ui/avatar'
import { Badge } from '../llui/ui/badge'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from '../llui/ui/breadcrumb'
import {
  Carousel,
  CarouselContent,
  CarouselIndicator,
  CarouselIndicatorGroup,
  CarouselNext,
  CarouselPrevious,
  CarouselViewport,
} from '../llui/ui/carousel'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../llui/ui/card'
import { ChartContainer, ChartMark, ChartSvg, ChartTable } from '../llui/ui/chart'
import { Chip } from '../llui/ui/chip'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../llui/ui/collapsible'
import {
  DataTableEmptyDescription,
  DataTableEmptyState,
  DataTableEmptyTitle,
  DataTableErrorState,
  DataTableLoadingOverlay,
} from '../llui/ui/data-table'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '../llui/ui/empty'
import { Item, ItemContent, ItemDescription, ItemTitle } from '../llui/ui/item'
import { Kbd, KbdGroup } from '../llui/ui/kbd'
import { Marquee, MarqueeContent } from '../llui/ui/marquee'
import { Meter, MeterBand, MeterMarker, MeterRange, MeterTrack } from '../llui/ui/meter'
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '../llui/ui/pagination'
import { Progress, ProgressRange, ProgressTrack } from '../llui/ui/progress'
import { Separator } from '../llui/ui/separator'
import {
  Sidebar,
  SidebarContainer,
  SidebarContent,
  SidebarGap,
  SidebarHeader,
  SidebarInner,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMobile,
  SidebarProvider,
} from '../llui/ui/sidebar'
import { Skeleton } from '../llui/ui/skeleton'
import {
  Sparkline,
  SparklineDot,
  SparklineLine,
  SparklineSvg,
  SparklineTable,
} from '../llui/ui/sparkline'
import { Spinner } from '../llui/ui/spinner'
import { Steps, StepsItem, StepsTrigger } from '../llui/ui/steps'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../llui/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../llui/ui/tabs'
import { Toc, TocLink, TocList } from '../llui/ui/toc'
import { TreeView, TreeViewBranchTrigger, TreeViewItem } from '../llui/ui/tree-view'
import {
  TypographyBlockquote,
  TypographyH2,
  TypographyInlineCode,
  TypographyList,
  TypographyListItem,
  TypographyP,
  TypographyPre,
} from '../llui/ui/typography'
import { loadProductContract } from '../../packages/components/test/styles/navigation-data-contract-source'
import {
  applicableNavigationDataScenarios,
  compileNavigationDataCatalog,
  forcedColorScenarios,
  joinNavigationDataScenarios,
  scenarioEnvironmentProductIds,
} from '../../packages/components/test/styles/navigation-data-scenarios'

const contract = loadProductContract()
const catalog = compileNavigationDataCatalog(contract)
const joined = joinNavigationDataScenarios(catalog, contract)
const registryScenarios = applicableNavigationDataScenarios(joined, 'registryTailwind')
const registryProductIds = registryScenarios.map(({ productId }) => productId).sort()
const carouselParts = carouselMachine.connect(rootSignal(), () => {}, { id: 'registry-browser' })
const publishedDragOffset = (deltaX: number): string =>
  read(carouselParts.viewport['style.--carousel-drag-offset'], {
    ...carouselMachine.init({ count: 2 }),
    dragging: { startX: 100, deltaX },
  })!

// The active indicator's `aria-selected`/`data-active` are driven from the
// REAL machine (#264 review item 5), never hand-typed `true`/`''` literals —
// a drift in the real `indicator()` part's attribute pairing breaks this
// fixture instead of leaving a correct-looking but stale assertion.
const carouselTwoSlideState = carouselMachine.init({ count: 2 })
const carouselActiveIndicator = carouselParts.slide(0).indicator
const carouselActiveIndicatorAttrs = {
  ariaSelected: read(carouselActiveIndicator['aria-selected'], carouselTwoSlideState),
  dataActive: read(carouselActiveIndicator['data-active'], carouselTwoSlideState),
}

let app: ReturnType<typeof mountApp> | undefined

function fixture(): string {
  const host = document.createElement('div')
  document.body.appendChild(host)
  app = mountApp(
    host,
    component<null, never, never>({
      name: 'NavigationDataRegistryFixture',
      init: () => [null, []],
      update: (state) => [state, []],
      view: () => [
        div([
          Tabs({ id: 'tabs', 'data-product': 'tabs', 'data-orientation': 'horizontal' }, [
            TabsList({ id: 'tab-list' }, [
              TabsTrigger(
                { id: 'tab-inactive', 'data-state': 'inactive', 'data-forced-state': 'regular' },
                [text('Summary')],
              ),
              TabsTrigger(
                { id: 'tab-active', 'data-state': 'active', 'data-forced-state': 'selected' },
                [text('Details')],
              ),
            ]),
            TabsContent([text('Content')]),
          ]),
          Accordion({ 'data-product': 'accordion', exitCompletion: text('') }, [
            AccordionItem([
              AccordionTrigger({ id: 'accordion-trigger', 'data-state': 'open' }, [text('Open')]),
              AccordionContent(
                { id: 'accordion-content', 'data-state': 'open', 'data-motion-state': '' },
                [text('Details')],
              ),
              AccordionContent(
                {
                  id: 'accordion-content-closing',
                  'data-state': 'closing',
                  'aria-hidden': 'true',
                  inert: true,
                },
                [text('Closing details')],
              ),
            ]),
          ]),
          Alert({ 'data-product': 'alert', variant: 'destructive' }, [
            AlertTitle([text('Sync failed')]),
            AlertDescription([text('Try again')]),
          ]),
          div({ 'data-product': 'avatar' }, [
            Avatar({ id: 'avatar', 'data-density': 'comfortable' }, [
              AvatarFallback({ id: 'avatar-fallback' }, [text('LL')]),
            ]),
            Avatar({ id: 'avatar-compact', 'data-density': 'compact', 'data-size': 'sm' }, [
              AvatarFallback([text('LL')]),
            ]),
          ]),
          Badge({ 'data-product': 'badge', variant: 'secondary' }, [text('Preview')]),
          Breadcrumb({ 'data-product': 'breadcrumbs' }, [
            BreadcrumbList([
              BreadcrumbItem([
                BreadcrumbLink({ 'data-forced-state': 'regular' }, [text('Projects')]),
              ]),
              BreadcrumbSeparator({ id: 'breadcrumb-separator' }, [svg([path({ d: 'M0 0' })])]),
              BreadcrumbItem([
                BreadcrumbLink(
                  {
                    id: 'breadcrumb-current',
                    'data-current': '',
                    'aria-current': 'page',
                    'data-forced-state': 'current',
                  },
                  [text('Alignment')],
                ),
              ]),
            ]),
          ]),
          Card({ 'data-product': 'card' }, [
            CardHeader([
              CardTitle([text('Release')]),
              CardDescription([text('Navigation defaults')]),
              CardAction([text('⋯')]),
            ]),
            CardContent([text('Ready')]),
          ]),
          Chip({ 'data-product': 'chip', value: 'lab' }),
          Collapsible({ 'data-product': 'collapsible', exitCompletion: text('') }, [
            CollapsibleTrigger({ id: 'collapsible-trigger', 'data-state': 'open' }, [
              text('Details'),
            ]),
            CollapsibleContent(
              { id: 'collapsible-content', 'data-state': 'open', 'data-motion-state': '' },
              [text('Expanded content')],
            ),
            CollapsibleContent(
              {
                id: 'collapsible-content-closing',
                'data-state': 'closing',
                'aria-hidden': 'true',
                inert: true,
              },
              [text('Closing content')],
            ),
          ]),
          div(
            {
              'data-product': 'data-table',
              class: 'relative min-w-0 overflow-hidden rounded-md border',
            },
            [
              DataTableLoadingOverlay({ hidden: true }, [text('Loading')]),
              DataTableEmptyState({ id: 'data-table-empty', 'data-forced-state': 'empty' }, [
                DataTableEmptyTitle([text('No results')]),
                DataTableEmptyDescription([text('Change the filters')]),
              ]),
              DataTableErrorState(
                {
                  id: 'data-table-error',
                  'data-forced-state': 'error',
                  'data-narrow-probe': '',
                },
                [text('Could not load')],
              ),
              Table({ 'data-density': 'compact' }, [
                TableHeader([
                  TableRow([TableHead({ id: 'data-table-compact-head' }, [text('Name')])]),
                ]),
                TableBody([TableRow([TableCell([text('Alpha')])])]),
              ]),
            ],
          ),
          Empty({ 'data-product': 'empty' }, [
            EmptyHeader([
              EmptyTitle([text('Nothing here')]),
              EmptyDescription([text('Create the first item')]),
            ]),
            EmptyContent([text('Add item')]),
          ]),
          div({ 'data-product': 'item' }, [
            Item({ id: 'item-comfortable', 'data-density': 'comfortable', variant: 'muted' }, [
              ItemContent([
                ItemTitle([text('Deployment')]),
                ItemDescription([text('Completed successfully')]),
              ]),
            ]),
            Item({ id: 'item-compact', 'data-density': 'compact', size: 'sm' }, [
              ItemContent([
                ItemTitle([text('Deployment')]),
                ItemDescription([text('Completed successfully')]),
              ]),
            ]),
          ]),
          KbdGroup({ 'data-product': 'kbd' }, [Kbd([text('⌘')]), Kbd([text('K')])]),
          Pagination({ 'data-product': 'pagination' }, [
            PaginationContent({ 'data-narrow-probe': '' }, [
              PaginationItem([PaginationPrevious({ id: 'pagination-previous' })]),
              ...Array.from({ length: 10 }, (_, index) =>
                PaginationItem([
                  PaginationLink(
                    {
                      id: index === 0 ? 'page-regular' : index === 1 ? 'page-current' : undefined,
                      'data-selected': index === 1 ? '' : undefined,
                      'data-forced-state':
                        index === 0 ? 'regular' : index === 1 ? 'current' : undefined,
                    },
                    [text(String(index + 1))],
                  ),
                ]),
              ),
              PaginationItem([PaginationNext({ id: 'pagination-next' })]),
            ]),
          ]),
          Pagination({ id: 'pagination-disabled', 'data-disabled': '' }, [
            PaginationLink(
              { id: 'pagination-disabled-item', 'data-part': 'item', 'data-value': '1' },
              [text('1')],
            ),
          ]),
          Steps({ id: 'steps', 'data-product': 'steps' }, [
            StepsItem([
              StepsTrigger(
                {
                  id: 'steps-current',
                  'data-status': 'current',
                  'aria-current': 'step',
                  'data-forced-state': 'current',
                },
                [text('Step')],
              ),
            ]),
            StepsItem([
              StepsTrigger(
                {
                  id: 'steps-error',
                  'data-status': 'error',
                  'data-forced-state': 'error',
                },
                [text('Step')],
              ),
            ]),
          ]),
          Steps({ id: 'steps-disabled', 'data-disabled': '' }, [
            StepsItem([
              StepsTrigger(
                { id: 'steps-disabled-trigger', 'data-part': 'trigger', disabled: true },
                [text('Disabled')],
              ),
            ]),
          ]),
          Meter({ 'data-product': 'meter' }, [
            MeterTrack({ id: 'meter-track', 'data-forced-surface': '' }, [
              MeterRange({
                id: 'meter-critical',
                'data-state': 'critical',
                style: 'inline-size:82%',
              }),
              MeterBand({
                id: 'meter-optimal',
                'data-state': 'optimal',
                'data-forced-state': 'optimal',
                style: 'inset-inline-start:0;inline-size:34%',
              }),
              MeterBand({
                id: 'meter-suboptimal',
                'data-state': 'suboptimal',
                'data-forced-state': 'suboptimal',
                style: 'inset-inline-start:34%;inline-size:33%',
              }),
              MeterBand({
                id: 'meter-critical-band',
                'data-state': 'critical',
                'data-forced-state': 'critical',
                style: 'inset-inline-start:67%;inline-size:33%',
              }),
              MeterMarker({ id: 'meter-marker', style: 'inset-inline-start:82%' }),
            ]),
            div({ 'data-forced-label': 'optimal' }, [text('Optimal range')]),
            div({ 'data-forced-label': 'suboptimal' }, [text('Caution range')]),
            div({ 'data-forced-label': 'critical' }, [text('Critical range')]),
          ]),
          Progress({ 'data-product': 'progress' }, [
            ProgressTrack({ id: 'progress-track-indeterminate' }, [
              ProgressRange({
                id: 'progress-range',
                'data-state': 'indeterminate',
                'data-motion-state': '',
              }),
            ]),
          ]),
          Progress({ 'data-orientation': 'vertical', style: 'height:128px' }, [
            ProgressTrack({ id: 'progress-track-vertical', 'data-orientation': 'vertical' }, [
              ProgressRange({
                id: 'progress-range-vertical',
                'data-orientation': 'vertical',
                style: 'height:60%',
              }),
            ]),
          ]),
          Progress({ 'data-orientation': 'vertical', style: 'height:128px' }, [
            ProgressTrack(
              { id: 'progress-track-vertical-indeterminate', 'data-orientation': 'vertical' },
              [
                ProgressRange({
                  id: 'progress-range-vertical-indeterminate',
                  'data-orientation': 'vertical',
                  'data-state': 'indeterminate',
                }),
              ],
            ),
          ]),
          div({ 'data-product': 'chart', 'data-forced-required-modes': 'cartesian polar' }, [
            ChartContainer(
              {
                id: 'chart',
                'data-forced-mode': 'cartesian',
                'data-coord': 'cartesian',
                'data-domain': 'value',
              },
              [
                ChartSvg({ id: 'chart-svg', viewBox: '0 0 300 150' }, [
                  ChartMark({
                    id: 'chart-bar',
                    'data-mark': 'bar',
                    'data-series': 'revenue',
                    'data-series-cue': 'solid',
                    'data-forced-state': 'bar',
                    style: '--mark-color:var(--chart-1)',
                    d: 'M20 20H80V120H20Z',
                  }),
                  ChartMark({
                    id: 'chart-line',
                    'data-mark': 'line',
                    'data-series': 'cost',
                    'data-series-cue': 'short-dash',
                    'data-forced-state': 'line',
                    style: '--mark-color:var(--chart-2)',
                    d: 'M20 100L150 40L280 90',
                  }),
                ]),
                div({ 'data-forced-label': 'revenue' }, [text('Revenue, bar series')]),
                div({ 'data-forced-label': 'cost' }, [text('Cost, dashed line series')]),
                ChartTable({ id: 'chart-table' }),
              ],
            ),
            ChartContainer(
              {
                'data-forced-mode': 'polar',
                'data-coord': 'polar',
                'data-domain': 'value',
              },
              [
                ChartSvg({ viewBox: '0 0 300 150' }, [
                  ChartMark({
                    'data-mark': 'bar',
                    'data-series': 'revenue',
                    'data-series-cue': 'solid',
                    'data-forced-state': 'bar',
                    'data-forced-mode': 'polar',
                    d: 'M150 75L150 15A60 60 0 0 1 210 75Z',
                  }),
                  ChartMark({
                    'data-mark': 'line',
                    'data-series': 'cost',
                    'data-series-cue': 'short-dash',
                    'data-forced-state': 'line',
                    'data-forced-mode': 'polar',
                    d: 'M150 15L210 75L150 135L90 75Z',
                  }),
                ]),
                div({ 'data-forced-label': 'revenue' }, [text('Revenue, polar bar series')]),
                div({ 'data-forced-label': 'cost' }, [text('Cost, dashed polar line series')]),
              ],
            ),
          ]),
          Toc({ 'data-product': 'toc' }, [
            TocList({ id: 'toc-list' }, [
              TocLink({ 'data-forced-state': 'regular' }, [text('Entry')]),
              TocLink(
                {
                  id: 'toc-current',
                  'data-active': '',
                  'aria-current': 'location',
                  'data-forced-state': 'current',
                },
                [text('Entry')],
              ),
            ]),
          ]),
          // Marquee's partial registry contract leaves motion to the consumer.
          // Supply a real loop and its reduced-motion override so this fixture
          // exercises that boundary instead of passing on a motionless wrapper.
          Marquee({ id: 'marquee', 'data-product': 'marquee', 'data-axis': 'horizontal' }, [
            MarqueeContent(
              {
                'data-motion-state': '',
                class:
                  '[animation:registry-marquee_20s_linear_infinite] motion-reduce:animate-none!',
              },
              [text('One · Two · One · Two')],
            ),
          ]),
          Marquee({ id: 'marquee-vertical', 'data-axis': 'vertical' }, [
            MarqueeContent({ id: 'marquee-content-vertical' }, [text('One · Two · One · Two')]),
          ]),
          Marquee({ id: 'marquee-disabled', 'data-axis': 'horizontal', 'data-disabled': '' }, [
            MarqueeContent([text('Paused')]),
          ]),
          // Wrapped in a padded container that carries `data-product`
          // instead of `Carousel`'s own tight root (#264 review item 9):
          // shadcn's upstream previous/next sit OUTSIDE the carousel frame
          // (`-start-12`/`-end-12`), which a real app accommodates with
          // surrounding space, exactly as this wrapper does — `Carousel`'s
          // own box was never meant to be the containment boundary for
          // affordances upstream deliberately places outside it.
          div({ id: 'carousel-affordance-root', 'data-product': 'carousel', class: 'px-14' }, [
            Carousel({ id: 'carousel' }, [
              CarouselViewport({ id: 'carousel-viewport' }, [
                CarouselContent({ id: 'carousel-track', 'data-motion-state': '' }, [text('Slide')]),
              ]),
              CarouselPrevious({
                id: 'carousel-previous',
                'data-narrow-probe': '',
                'data-narrow-affordance': '',
                'data-logical-side': 'start',
              }),
              CarouselNext({
                id: 'carousel-next',
                'data-narrow-affordance': '',
                'data-logical-side': 'end',
              }),
              CarouselIndicatorGroup([
                CarouselIndicator({
                  id: 'carousel-dot-active',
                  'data-active': carouselActiveIndicatorAttrs.dataActive,
                  'aria-selected': carouselActiveIndicatorAttrs.ariaSelected,
                  tabindex: 0,
                  'data-narrow-affordance': '',
                  'data-logical-side': 'flow',
                }),
                CarouselIndicator({
                  id: 'carousel-dot',
                  tabindex: -1,
                  'data-narrow-affordance': '',
                  'data-logical-side': 'flow',
                }),
              ]),
            ]),
          ]),
          div({ 'data-product': 'separator', class: 'flex h-8 items-center gap-2' }, [
            Separator({ id: 'separator-horizontal', 'data-forced-state': 'horizontal' }),
            Separator({
              id: 'separator-vertical',
              orientation: 'vertical',
              'data-forced-state': 'vertical',
            }),
          ]),
          SidebarProvider(
            {
              id: 'sidebar-provider',
              'data-product': 'sidebar',
              style: '--sidebar-width:16rem;--sidebar-width-icon:3rem;--sidebar-width-mobile:18rem',
            },
            [
              SidebarMobile({ id: 'sidebar-mobile' }, [
                SidebarHeader([text('Workspace')]),
                SidebarContent([text('Mobile navigation')]),
              ]),
              Sidebar(
                {
                  id: 'sidebar-desktop',
                  'data-state': 'expanded',
                  'data-side': 'left',
                  'data-collapsible': '',
                  'data-variant': 'sidebar',
                },
                [
                  SidebarGap(),
                  SidebarContainer([
                    SidebarInner([
                      SidebarHeader([text('Workspace')]),
                      SidebarContent([
                        SidebarMenu([
                          SidebarMenuItem([
                            SidebarMenuButton(
                              {
                                id: 'sidebar-menu-button',
                                'data-active': 'true',
                                'data-narrow-probe': '',
                              },
                              [text('Current')],
                            ),
                            SidebarMenuButton(
                              {
                                id: 'sidebar-menu-button-compact',
                                'data-density': 'compact',
                                size: 'sm',
                              },
                              [text('Compact')],
                            ),
                          ]),
                        ]),
                      ]),
                    ]),
                  ]),
                ],
              ),
              SidebarInset([text('Content')]),
            ],
          ),
          Sparkline({ 'data-product': 'sparkline' }, [
            SparklineSvg({ id: 'sparkline-svg', viewBox: '0 0 120 32' }, [
              SparklineLine({ d: 'M0 20L40 10L80 18L120 4' }),
              SparklineDot({
                id: 'sparkline-above',
                'data-tone': 'above',
                'data-forced-state': 'above',
                cx: 80,
                cy: 18,
              }),
              SparklineDot({
                id: 'sparkline-below',
                'data-tone': 'below',
                'data-forced-state': 'below',
                cx: 120,
                cy: 4,
              }),
            ]),
            div({ 'data-forced-label': 'above' }, [text('Above reference range')]),
            div({ 'data-forced-label': 'below' }, [text('Below reference range')]),
            SparklineTable(),
          ]),
          Tabs({ 'data-orientation': 'vertical' }, [
            TabsList({ 'data-variant': 'line' }, [
              TabsTrigger({ id: 'vertical-tab-active', 'data-state': 'active' }, [text('Active')]),
            ]),
          ]),
          div({ 'data-product': 'table', class: 'min-w-0' }, [
            Table(
              {
                viewport: { 'data-scope': 'table', 'data-part': 'viewport' },
                'data-density': 'comfortable',
              },
              [
                TableHeader([TableRow([TableHead({ id: 'table-head' }, [text('Name')])])]),
                TableBody([
                  TableRow(
                    {
                      id: 'table-row-regular',
                      'data-forced-state': 'regular',
                    },
                    [
                      TableCell({ id: 'table-cell', 'data-narrow-probe': '' }, [
                        text('LLui with a long unbroken cell value'),
                      ]),
                    ],
                  ),
                  TableRow(
                    {
                      id: 'table-row-selected',
                      'data-selected': '',
                      'aria-selected': true,
                      'data-forced-state': 'selected',
                    },
                    [TableCell([text('LLui with a long unbroken cell value')])],
                  ),
                ]),
              ],
            ),
            Table(
              {
                viewport: { 'data-scope': 'table', 'data-part': 'viewport' },
                'data-density': 'compact',
              },
              [
                TableHeader([TableRow([TableHead({ id: 'table-compact-head' }, [text('Name')])])]),
                TableBody([TableRow([TableCell([text('Alpha')])])]),
              ],
            ),
          ]),
          Table(
            {
              viewport: { 'data-scope': 'table', 'data-part': 'viewport' },
              id: 'table-disabled',
              'data-disabled': '',
            },
            [TableBody([TableRow([TableCell([text('Disabled')])])])],
          ),
          TreeView({ 'data-product': 'tree-view', role: 'tree' }, [
            TreeViewItem({ id: 'tree-regular', role: 'treeitem', 'data-forced-state': 'regular' }, [
              text('README.md'),
            ]),
            TreeViewItem(
              {
                id: 'tree-selected',
                role: 'treeitem',
                'data-selected': '',
                'aria-selected': true,
                'data-forced-state': 'selected',
              },
              [
                TreeViewBranchTrigger({ id: 'tree-branch', 'data-state': 'open' }, [text('›')]),
                text('src'),
              ],
            ),
          ]),
          div({ 'data-product': 'typography', class: 'min-w-0' }, [
            TypographyH2([text('Reference')]),
            TypographyP([text('Use '), TypographyInlineCode([text('data-current')])]),
            TypographyBlockquote({ id: 'typography-quote' }, [text('Logical start')]),
            TypographyList({ id: 'typography-list' }, [
              TypographyListItem([text('Logical indentation')]),
            ]),
            TypographyPre({ id: 'typography-pre', 'data-narrow-probe': '' }, [
              text('averyveryveryveryveryveryveryveryveryverylongtoken'),
            ]),
          ]),
          Skeleton({ id: 'skeleton', 'data-product': 'skeleton', 'data-motion-state': '' }),
          Spinner({ id: 'spinner', 'data-product': 'spinner', 'data-motion-state': '' }),
        ]),
      ],
    }),
  )
  return host.innerHTML
}

function candidates(html: string): string[] {
  const template = document.createElement('template')
  template.innerHTML = html
  return [
    ...new Set(
      [...template.content.querySelectorAll<HTMLElement>('[class]')]
        .flatMap((element) => [...element.classList])
        .filter((candidate) => markerName(candidate) === null),
    ),
  ]
}

describe('registry navigation/data presentation in Chromium', () => {
  let browser: Browser
  let html: string
  let tailwind: string

  beforeAll(async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          prefix: 'lucide',
          width: 24,
          height: 24,
          icons: {
            'chevron-down': { body: '<path d="m6 9 6 6 6-6" />' },
            'chevron-left': { body: '<path d="m15 18-6-6 6-6" />' },
            'chevron-right': { body: '<path d="m9 18 6-6-6-6" />' },
            'loader-circle': { body: '<path d="M21 12a9 9 0 1 1-6.2-8.6" />' },
          },
        }),
      }),
    )
    html = fixture()
    const compiled = await compileCandidates(candidates(html))
    expect(compiled.dead).toEqual([])
    tailwind = `${compiled.css}\n@keyframes registry-marquee { from { transform: translateX(0) } to { transform: translateX(-50%) } }`
    browser = await chromium.launch({ headless: true })
  }, 120_000)

  afterAll(async () => {
    app?.dispose()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
    await browser?.close()
  })

  it('renders every canonical product with a registry presentation', async () => {
    const page = await browser.newPage()
    await page.setContent(`<!doctype html><style>${tailwind}</style>${html}`)
    const rendered = await page
      .locator('[data-product]')
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('data-product')).filter((value) => value !== null),
      )
    await page.close()

    expect(rendered.sort()).toEqual(registryProductIds)
  })

  it('turns applicable compact scenario inputs into denser, still-usable geometry', async () => {
    const page = await browser.newPage()
    await page.setContent(`<!doctype html><style>${tailwind}</style>${html}`)
    const geometry = await page.evaluate(() => {
      const size = (id: string) => {
        const rect = document.getElementById(id)!.getBoundingClientRect()
        return { width: rect.width, height: rect.height }
      }
      return {
        avatar: { comfortable: size('avatar'), compact: size('avatar-compact') },
        table: { comfortable: size('table-head'), compact: size('table-compact-head') },
        dataTable: { compact: size('data-table-compact-head') },
        item: { comfortable: size('item-comfortable'), compact: size('item-compact') },
        sidebar: {
          comfortable: size('sidebar-menu-button'),
          compact: size('sidebar-menu-button-compact'),
        },
      }
    })
    await page.close()

    for (const geometryPair of [geometry.avatar, geometry.table, geometry.item, geometry.sidebar]) {
      expect(geometryPair.compact.height).toBeLessThan(geometryPair.comfortable.height)
      expect(geometryPair.compact.height).toBeGreaterThanOrEqual(24)
    }
    expect(geometry.dataTable.compact.height).toBe(geometry.table.compact.height)
  })

  it('renders the canonical density, hierarchy, and selected/status states', async () => {
    const page = await browser.newPage()
    await page.setContent(`<!doctype html><style>${tailwind}</style>${html}`)
    const got = await page.evaluate(() => {
      const style = (id: string): CSSStyleDeclaration =>
        getComputedStyle(document.getElementById(id)!)
      return {
        tabs: {
          height: style('tab-list').height,
          inactive: style('tab-inactive').backgroundColor,
          active: style('tab-active').backgroundColor,
          shadow: style('tab-active').boxShadow,
        },
        avatar: [style('avatar').width, style('avatar').height, style('avatar-fallback').fontSize],
        breadcrumbCurrent: style('breadcrumb-current').color,
        page: {
          regularBackground: style('page-regular').backgroundColor,
          currentBackground: style('page-current').backgroundColor,
          currentShadow: style('page-current').boxShadow,
        },
        meter: [
          style('meter-optimal').backgroundColor,
          style('meter-critical-band').backgroundColor,
          style('meter-critical').backgroundColor,
        ],
        chart: {
          bar: style('chart-bar').fill,
          lineFill: style('chart-line').fill,
          lineStroke: style('chart-line').stroke,
          tablePosition: style('chart-table').position,
        },
        progress: {
          verticalTrack: [
            style('progress-track-vertical').width,
            style('progress-track-vertical').height,
          ],
          verticalRangeWidth: style('progress-range-vertical').width,
          horizontalIndeterminate: {
            animation: style('progress-range').animationName,
            ratio:
              document.getElementById('progress-range')!.getBoundingClientRect().width /
              document.getElementById('progress-track-indeterminate')!.getBoundingClientRect()
                .width,
          },
          verticalIndeterminate: {
            animation: style('progress-range-vertical-indeterminate').animationName,
            width: style('progress-range-vertical-indeterminate').width,
            ratio:
              document
                .getElementById('progress-range-vertical-indeterminate')!
                .getBoundingClientRect().height /
              document
                .getElementById('progress-track-vertical-indeterminate')!
                .getBoundingClientRect().height,
          },
        },
        marquee: {
          direction: style('marquee-content-vertical').flexDirection,
          horizontalMask: style('marquee').maskImage,
          verticalMask: style('marquee-vertical').maskImage,
        },
        disabled: {
          pagination: [
            style('pagination-disabled').opacity,
            style('pagination-disabled').pointerEvents,
            style('pagination-disabled-item').opacity,
          ],
          steps: [
            style('steps-disabled').opacity,
            style('steps-disabled').pointerEvents,
            style('steps-disabled-trigger').opacity,
          ],
          table: [style('table-disabled').opacity, style('table-disabled').pointerEvents],
          marquee: style('marquee-disabled').opacity,
        },
        carousel: {
          targets: [
            'carousel-previous',
            'carousel-next',
            'carousel-dot-active',
            'carousel-dot',
          ].map((id) => {
            const rect = document.getElementById(id)!.getBoundingClientRect()
            return [rect.width, rect.height]
          }),
          dots: ['carousel-dot-active', 'carousel-dot'].map((id) => {
            const pseudo = getComputedStyle(document.getElementById(id)!, '::before')
            return [pseudo.width, pseudo.height, pseudo.backgroundColor]
          }),
        },
      }
    })
    await page.close()

    expect(got.tabs.height).toBe('36px')
    expect(got.tabs.active).not.toBe(got.tabs.inactive)
    expect(got.tabs.shadow).not.toBe('none')
    expect(got.avatar).toEqual(['32px', '32px', '14px'])
    expect(got.breadcrumbCurrent).not.toBe('')
    expect(got.page.currentBackground).not.toBe(got.page.regularBackground)
    expect(got.page.currentShadow).not.toBe('none')
    expect(new Set(got.meter).size).toBe(3)
    expect(got.chart.bar).not.toBe(got.chart.lineStroke)
    expect(got.chart.lineFill).toBe('none')
    expect(got.chart.tablePosition).toBe('absolute')
    expect(got.progress.verticalTrack).toEqual(['8px', '128px'])
    expect(got.progress.verticalRangeWidth).toBe('8px')
    expect(got.progress.horizontalIndeterminate.animation).toBe('pulse')
    expect(got.progress.horizontalIndeterminate.ratio).toBeCloseTo(1 / 3, 2)
    expect(got.progress.verticalIndeterminate.animation).toBe('pulse')
    expect(got.progress.verticalIndeterminate.width).toBe('8px')
    expect(got.progress.verticalIndeterminate.ratio).toBeCloseTo(1 / 3, 2)
    expect(got.marquee.direction).toBe('column')
    expect(got.marquee.horizontalMask).toContain('to right')
    // Chromium serializes the default vertical axis without an explicit
    // `to bottom`; the absence of the horizontal direction is the axis proof.
    expect(got.marquee.verticalMask).not.toContain('to right')
    expect(got.marquee.verticalMask).not.toBe(got.marquee.horizontalMask)
    expect(got.disabled.pagination).toEqual(['0.5', 'none', '1'])
    expect(got.disabled.steps).toEqual(['0.5', 'none', '1'])
    expect(got.disabled.table).toEqual(['0.5', 'none'])
    expect(got.disabled.marquee).toBe('0.5')
    expect(got.carousel.targets.every(([width, height]) => width >= 24 && height >= 24)).toBe(true)
    expect(got.carousel.dots.map(([width, height]) => [width, height])).toEqual([
      ['8px', '8px'],
      ['8px', '8px'],
    ])
    expect(got.carousel.dots[0]?.[2]).not.toBe(got.carousel.dots[1]?.[2])
  })

  it('gives retained disclosure content aligned enter and exit motion', async () => {
    const context = await browser.newContext({ reducedMotion: 'no-preference' })
    const page = await context.newPage()
    await page.setContent(`<!doctype html><style>${tailwind}</style>${html}`)
    const motion = await page.evaluate(() => {
      const read = (id: string) => {
        const element = document.getElementById(id)!
        const style = getComputedStyle(element)
        return {
          animation: style.animationName,
          duration: style.animationDuration,
          display: style.display,
          pointerEvents: style.pointerEvents,
          ariaHidden: element.getAttribute('aria-hidden'),
          inert: element.hasAttribute('inert'),
        }
      }
      return {
        accordionOpen: read('accordion-content'),
        accordionClosing: read('accordion-content-closing'),
        collapsibleOpen: read('collapsible-content'),
        collapsibleClosing: read('collapsible-content-closing'),
      }
    })
    await context.close()

    expect(motion.accordionOpen.animation).toBe('accordion-down')
    expect(motion.accordionClosing.animation).toBe('accordion-up')
    expect(motion.collapsibleOpen.animation).toBe('accordion-down')
    expect(motion.collapsibleClosing.animation).toBe('accordion-up')
    for (const surface of [motion.accordionClosing, motion.collapsibleClosing]) {
      expect(Number.parseFloat(surface.duration)).toBeGreaterThan(0.001)
      expect(surface.display).not.toBe('none')
      expect(surface.pointerEvents).toBe('none')
      expect(surface.ariaHidden).toBe('true')
      expect(surface.inert).toBe(true)
    }

    const reduced = await browser.newContext({ reducedMotion: 'reduce' })
    const reducedPage = await reduced.newPage()
    await reducedPage.setContent(`<!doctype html><style>${tailwind}</style>${html}`)
    const durations = await reducedPage.evaluate(() =>
      [
        'accordion-content',
        'accordion-content-closing',
        'collapsible-content',
        'collapsible-content-closing',
      ].map((id) =>
        Number.parseFloat(getComputedStyle(document.getElementById(id)!).animationDuration),
      ),
    )
    await reduced.close()
    expect(durations.every((duration) => duration <= 0.001)).toBe(true)
  })

  it('contains every narrow and responsive-affordance scenario at full width', async () => {
    // The protocol's `viewport` axis is canonically two-valued
    // (`wide`/`narrow`), so a case declaring it is exercised at one
    // representative pixel width per side rather than three breakpoints.
    const directions = ['ltr', 'rtl'] as const
    const products: Record<string, NarrowProbe> = {}
    const widths = [280, 1024] as const
    const productsSupportingViewport = scenarioEnvironmentProductIds(registryScenarios, 'viewport')
    for (const width of widths) {
      for (const direction of directions) {
        for (const productId of productsSupportingViewport) {
          const page = await browser.newPage({ viewport: { width, height: 720 } })
          await page.setContent(
            `<!doctype html><html dir="${direction}"><style>${tailwind}</style><body>${html}</body></html>`,
          )
          products[`${width}:${direction}:${productId}`] = await probeNarrowProduct(page, productId)
          await page.close()
        }
      }
    }

    expect(Object.keys(products).sort()).toEqual(
      widths
        .flatMap((width) =>
          directions.flatMap((direction) =>
            productsSupportingViewport.map((productId) => `${width}:${direction}:${productId}`),
          ),
        )
        .sort(),
    )
    expect(
      Object.entries(products).filter(
        ([, result]) =>
          !result.pageContained ||
          !result.contained ||
          result.unusableOverflow.length > 0 ||
          result.affordances.some(
            ({ containedByRoot, containedByViewport, logicalPlacement, minimumTarget, usable }) =>
              !containedByRoot ||
              !containedByViewport ||
              !logicalPlacement ||
              !minimumTarget ||
              !usable,
          ),
      ),
    ).toEqual([])
    for (const width of widths) {
      expect(products[`${width}:ltr:carousel`]?.affordances).toHaveLength(4)
      expect(products[`${width}:rtl:carousel`]?.affordances).toHaveLength(4)
    }
  })

  it('shows a keyboard-visible focus cue on an actual bare registry indicator', async () => {
    const page = await browser.newPage()
    await page.setContent(`<!doctype html><style>${tailwind}</style>${html}`)
    await page.evaluate(() => {
      for (const element of document.querySelectorAll<HTMLElement>('a,button,[tabindex]')) {
        element.tabIndex = -1
      }
      document.getElementById('carousel-dot-active')!.tabIndex = 0
    })
    await page.keyboard.press('Tab')
    const shadow = await page
      .locator('#carousel-dot-active')
      .evaluate((element) => getComputedStyle(element).boxShadow)
    await page.close()
    expect(shadow).not.toBe('none')
  })

  it('consumes the machine drag property as physical track geometry and removes motion on drag/reduce', async () => {
    for (const direction of ['ltr', 'rtl'] as const) {
      for (const deltaX of [-60, 60]) {
        const page = await browser.newPage()
        await page.setContent(
          `<!doctype html><html dir="${direction}"><style>${tailwind}</style><body>${html}</body></html>`,
        )
        await page.locator('#carousel-viewport').evaluate((viewport, offset) => {
          viewport.setAttribute('data-dragging', '')
          ;(viewport as HTMLElement).style.setProperty('--carousel-drag-offset', offset)
        }, publishedDragOffset(deltaX))
        const dragging = await page.locator('#carousel-track').evaluate((track) => {
          const style = getComputedStyle(track)
          return {
            x: new DOMMatrixReadOnly(style.transform).m41,
            transitionDuration: Number.parseFloat(style.transitionDuration),
          }
        })
        expect(dragging.x).toBe(deltaX)
        expect(dragging.transitionDuration).toBe(0)

        await page.locator('#carousel-viewport').evaluate((viewport) => {
          viewport.removeAttribute('data-dragging')
          ;(viewport as HTMLElement).style.removeProperty('--carousel-drag-offset')
        })
        await page.waitForFunction(
          () => {
            const track = document.getElementById('carousel-track')!
            return Math.abs(new DOMMatrixReadOnly(getComputedStyle(track).transform).m41) < 0.5
          },
          undefined,
          { timeout: 1_000 },
        )
        expect(
          await page
            .locator('#carousel-track')
            .evaluate((track) => new DOMMatrixReadOnly(getComputedStyle(track).transform).m41),
        ).toBeCloseTo(0, 0)
        await page.close()
      }
    }

    const context = await browser.newContext({ reducedMotion: 'reduce' })
    const page = await context.newPage()
    await page.setContent(`<!doctype html><style>${tailwind}</style>${html}`)
    expect(
      await page.locator('#carousel-track').evaluate((track) => {
        const style = getComputedStyle(track)
        return {
          property: style.transitionProperty,
          duration: Number.parseFloat(style.transitionDuration),
        }
      }),
    ).toMatchObject({ property: 'none' })
    await context.close()
  })

  it('gives both table roving stops a tokenized keyboard focus cue, including forced colours', async () => {
    const capture = async (forcedColors: 'none' | 'active') => {
      const context = await browser.newContext({ forcedColors })
      const page = await context.newPage()
      await page.setContent(`<!doctype html><style>${tailwind}</style>${html}`)
      const result: Record<
        string,
        { boxShadow: string; outlineStyle: string; outlineWidth: string }
      > = {}
      for (const id of ['table-head', 'table-cell']) {
        await page.evaluate((targetId) => {
          for (const element of document.querySelectorAll<HTMLElement>(
            'a,button,input,select,textarea,[tabindex]',
          )) {
            element.tabIndex = -1
          }
          document.getElementById(targetId)!.tabIndex = 0
        }, id)
        await page.keyboard.press('Tab')
        result[id] = await page.locator(`#${id}`).evaluate((element) => {
          const style = getComputedStyle(element)
          return {
            boxShadow: style.boxShadow,
            outlineStyle: style.outlineStyle,
            outlineWidth: style.outlineWidth,
          }
        })
      }
      await context.close()
      return result
    }

    const normal = await capture('none')
    expect(Object.values(normal).every(({ boxShadow }) => boxShadow !== 'none')).toBe(true)

    const forced = await capture('active')
    expect(
      Object.values(forced).every(
        ({ outlineStyle, outlineWidth }) => outlineStyle !== 'none' && outlineWidth === '2px',
      ),
    ).toBe(true)
  })

  it('preserves every declared state hierarchy in dark mode', async () => {
    const expected = scenarioEnvironmentProductIds(registryScenarios, 'theme')
    const capture = async (dark: boolean) => {
      const context = await browser.newContext({ colorScheme: dark ? 'dark' : 'light' })
      const page = await context.newPage()
      await page.setContent(
        `<!doctype html><html class="${dark ? 'dark' : 'light'}" data-theme="${dark ? 'dark' : 'light'}"><style>${tailwind}</style><body>${html}</body></html>`,
      )
      const result = await probeDarkStateHierarchy(page, expected)
      await context.close()
      return result
    }
    const light = await capture(false)
    const dark = await capture(true)

    expect(Object.keys(dark).sort()).toEqual(expected)
    expect(
      expected.filter(
        (productId) =>
          new Set(dark[productId]!.signatures).size < 2 ||
          dark[productId]!.backgroundToken === light[productId]!.backgroundToken ||
          dark[productId]!.signatures.join('\n') === light[productId]!.signatures.join('\n'),
      ),
    ).toEqual([])
  })

  it('uses logical geometry in RTL', async () => {
    const page = await browser.newPage()
    await page.setContent(
      `<!doctype html><html dir="rtl"><style>${tailwind}</style><body>${html}</body></html>`,
    )
    const got = await page.evaluate(() => {
      const style = (id: string): CSSStyleDeclaration =>
        getComputedStyle(document.getElementById(id)!)
      const carousel = document.getElementById('carousel')!.getBoundingClientRect()
      const previous = document.getElementById('carousel-previous')!.getBoundingClientRect()
      const next = document.getElementById('carousel-next')!.getBoundingClientRect()
      const sidebar = document.getElementById('sidebar-provider')!.getBoundingClientRect()
      return {
        accordion: { textAlign: style('accordion-trigger').textAlign },
        breadcrumbs: {
          separator: getComputedStyle(document.querySelector('#breadcrumb-separator svg')!).rotate,
        },
        carousel: {
          // Outside the frame now (#264 review item 9: `-start-12`/`-end-12`,
          // matching shadcn's upstream, not the previous `start-2`/`end-2`
          // deviation that sat the arrows INSIDE it) — under `dir="rtl"`,
          // logical `start` is the VISUAL RIGHT, so `previous` (at `-start-`)
          // sits outside on the right and `next` (at `-end-`) outside on the
          // left, the physical mirror of the LTR case.
          previousAtStart: previous.left >= carousel.right - 1 && previous.left > next.left,
          nextAtEnd: next.right <= carousel.left + 1 && next.right < previous.right,
          icons: [
            getComputedStyle(document.querySelector('#carousel-previous svg')!).rotate,
            getComputedStyle(document.querySelector('#carousel-next svg')!).rotate,
          ],
        },
        marquee: {
          direction: style('marquee').direction,
          overflow: style('marquee').overflow,
        },
        meter: { markerOffset: style('meter-marker').translate },
        pagination: {
          icons: [
            getComputedStyle(document.querySelector('#pagination-previous svg')!).rotate,
            getComputedStyle(document.querySelector('#pagination-next svg')!).rotate,
          ],
        },
        steps: {
          direction: style('steps').direction,
          current: style('steps-current').color,
          error: style('steps-error').color,
        },
        table: { textAlign: style('table-head').textAlign },
        tabs: {
          indicatorStart: getComputedStyle(
            document.getElementById('vertical-tab-active')!,
            '::after',
          ).left,
        },
        toc: { borders: [style('toc-list').borderLeftWidth, style('toc-list').borderRightWidth] },
        'tree-view': { branchRotation: style('tree-branch').rotate },
        typography: {
          quoteBorders: [
            style('typography-quote').borderLeftWidth,
            style('typography-quote').borderRightWidth,
          ],
          listMargins: [style('typography-list').marginLeft, style('typography-list').marginRight],
        },
        sidebar: {
          menuTextAlign: style('sidebar-menu-button').textAlign,
          contained: sidebar.left >= -0.5 && sidebar.right <= innerWidth + 0.5,
        },
      }
    })
    await page.close()

    const expected = scenarioEnvironmentProductIds(registryScenarios, 'direction')
    expect(Object.keys(got).sort()).toEqual(expected)
    expect(got.accordion.textAlign).toBe('start')
    expect(got.breadcrumbs.separator).toBe('180deg')
    expect(got.carousel).toMatchObject({ previousAtStart: true, nextAtEnd: true })
    expect(got.carousel.icons).toEqual(['180deg', '180deg'])
    expect(got.marquee).toEqual({ direction: 'rtl', overflow: 'hidden' })
    expect(got.meter.markerOffset).toBe('50%')
    expect(got.pagination.icons).toEqual(['180deg', '180deg'])
    expect(got.steps.direction).toBe('rtl')
    expect(got.steps.current).not.toBe(got.steps.error)
    expect(got.table.textAlign).toBe('start')
    expect(got.tabs.indicatorStart).toBe('-4px')
    expect(got.toc.borders).toEqual(['0px', '1px'])
    expect(got['tree-view'].branchRotation).toBe('-90deg')
    expect(got.sidebar).toEqual({ menuTextAlign: 'start', contained: true })
    expect(got.typography.quoteBorders).toEqual(['0px', '2px'])
    expect(got.typography.listMargins).toEqual(['0px', '24px'])
  })

  it('removes decorative animation for reduced-motion users', async () => {
    const expected = scenarioEnvironmentProductIds(registryScenarios, 'motion')
    const motion = await browser.newContext({ reducedMotion: 'no-preference' })
    const motionPage = await motion.newPage()
    await motionPage.setContent(`<!doctype html><style>${tailwind}</style>${html}`)
    const motionResult = await probeEffectiveMotion(motionPage, expected)
    await motion.close()

    expect(
      Object.entries(motionResult).filter(
        ([, maxDuration]) => !Number.isFinite(maxDuration) || maxDuration <= 0.001,
      ),
    ).toEqual([])

    const context = await browser.newContext({ reducedMotion: 'reduce' })
    const page = await context.newPage()
    await page.setContent(`<!doctype html><style>${tailwind}</style>${html}`)
    const got = await probeEffectiveMotion(page, expected)
    await context.close()

    expect(Object.keys(got).sort()).toEqual(expected)
    expect(
      Object.entries(got).filter(
        ([, maxDuration]) =>
          !Number.isFinite(maxDuration) || maxDuration < 0 || maxDuration > 0.001,
      ),
    ).toEqual([])
  })

  it('preserves every declared state distinction in forced colours', async () => {
    const context = await browser.newContext({ forcedColors: 'active' })
    const page = await context.newPage()
    await page.setContent(`<!doctype html><style>${tailwind}</style>${html}`)

    // Self-check the real pixel path before trusting it, and prove the
    // repo's two standard contrast canaries through the SAME paint+readback
    // path `probeForcedColorCues` uses (#264 review item 5) — never
    // arithmetic on hand-typed constants.
    await selfCheckPixelHarness(page)
    const [black, white, midTone] = await paintedColors(page, [
      '#000000',
      '#ffffff',
      'rgb(0 0 0 / 25%)',
    ])
    expect(
      contrast(
        srgb8ToLinear([black!.r, black!.g, black!.b]),
        srgb8ToLinear([white!.r, white!.g, white!.b]),
      ),
    ).toBeCloseTo(21, 1)
    expect(
      contrast(
        srgb8ToLinear([midTone!.r, midTone!.g, midTone!.b]),
        srgb8ToLinear([white!.r, white!.g, white!.b]),
      ),
    ).toBeCloseTo(1.838893, 5)

    const cases = forcedColorScenarios(registryScenarios)
    const got = await probeForcedColorCues(page, cases)
    await context.close()

    const expected = scenarioEnvironmentProductIds(registryScenarios, 'forcedColors')
    expect(cases.map(({ productId }) => productId)).toEqual(expected)
    expect(Object.keys(got).sort()).toEqual(expected)
    expect(Object.entries(got).filter(([, result]) => !result.passes)).toEqual([])
  })
})
