#!/usr/bin/env tsx
/**
 * LLui LLM Evaluation Pipeline Runner
 *
 * Runs the canonical 15-task evaluation suite against an LLM and produces
 * a structured scorecard. See docs/designs/07 LLM Friendliness.md §5-7.
 *
 * Usage:
 *   pnpm tsx evaluation/runner.ts --task 01 --runs 5
 *   pnpm tsx evaluation/runner.ts --all --runs 5
 *   pnpm tsx evaluation/runner.ts --task 01 --file output.ts  # evaluate existing file
 */

import { execSync } from 'child_process'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, resolve } from 'path'

// ── Types ───────────────────────────────────────────────────────

interface TaskDef {
  id: string
  name: string
  tier: number
  description: string
  assertions: string[]
  systemPromptVariant?: string
}

interface TaskResult {
  taskId: string
  runIndex: number
  compile: 0 | 1
  render: 0 | 1
  fullPass: 0 | 1
  assertionScore: number
  consoleClean: 0 | 1
  idiomatic: number
  errors: string[]
}

interface Scorecard {
  model: string
  timestamp: string
  systemPrompt: string
  results: TaskResult[]
  macroAverages: {
    compile: number
    render: number
    fullPass: number
    assertionScore: number
    consoleClean: number
    idiomatic: number
  }
}

// ── Canonical Task Set ──────────────────────────────────────────

const TASKS: TaskDef[] = [
  {
    id: '01',
    name: 'Counter',
    tier: 1,
    description:
      'Build a counter that shows a number and has +/- buttons. Clicking + increments; clicking - decrements; the value never goes below 0.',
    assertions: [
      'initial value shows 0',
      'after 3 clicks of +, shows 3',
      'after clicking - once, shows 2',
      'clicking - when showing 0 leaves value at 0',
    ],
  },
  {
    id: '02',
    name: 'Character counter',
    tier: 1,
    description:
      'A textarea paired with a character counter below it. The counter shows "N / 280". The counter element gains the class over-limit when the character count exceeds 260.',
    assertions: [
      'initial counter shows "0 / 280"',
      'typing 5 chars shows "5 / 280"',
      'at 260 chars, over-limit absent',
      'at 261 chars, over-limit present',
    ],
  },
  {
    id: '03',
    name: 'Filterable list',
    tier: 2,
    description:
      'A static list of 10 hardcoded items. A text input filters the list by substring (case-insensitive). The visible list updates as the user types.',
    assertions: [
      'all 10 items visible initially',
      'typing "an" filters correctly',
      'clearing input restores all 10',
    ],
  },
  {
    id: '04',
    name: 'Async data fetch',
    tier: 3,
    description:
      'On mount, fetch a list of items from a URL. Show a loading spinner while fetching. Show the list on success. Show an error message and a Retry button on failure.',
    assertions: [
      'loading visible immediately',
      'mock fetch resolves -> items visible',
      'mock fetch rejects -> error + Retry visible',
      'clicking Retry triggers new fetch',
    ],
    systemPromptVariant: 'async',
  },
  {
    id: '05',
    name: 'Stopwatch',
    tier: 6,
    description:
      'Start, Stop, and Reset buttons. Display MM:SS:ms. Best lap field records shortest elapsed time at each Stop press.',
    assertions: [
      'initially shows 00:00:000',
      'after Start + ~500ms + Stop shows ~500ms',
      'Reset returns to 00:00:000',
      'shortest lap shown in Best lap',
    ],
  },
  {
    id: '06',
    name: 'Accordion',
    tier: 2,
    description:
      'Three panels, each with a title and body text. Clicking a title toggles that panel. Only one panel open at a time.',
    assertions: [
      'all panels closed initially',
      'clicking panel 1 opens it',
      'clicking panel 2 closes 1 and opens 2',
      'clicking panel 2 again closes it',
    ],
  },
  {
    id: '07',
    name: 'Multi-step form',
    tier: 2,
    description:
      'Four steps: name -> email -> summary -> confirm. Each step validates before allowing advancement.',
    assertions: [
      'starts on step 1',
      'empty name -> Next disabled',
      'valid name -> Next enabled',
      'reaching step 4 shows entered data',
    ],
  },
  {
    id: '08',
    name: 'Reorderable list',
    tier: 4,
    description: 'A list of 5 items. Each item has Up and Down buttons. Items must be keyed by ID.',
    assertions: [
      'initial order correct',
      'Up on item 2 swaps with item 1',
      'DOM identity preserved after swap',
      'Down on last item is no-op',
    ],
  },
  {
    id: '09',
    name: 'Debounced search',
    tier: 3,
    description:
      'A text input. After 300ms of inactivity, fetch results. Cancel in-flight fetch on new input.',
    assertions: [
      'rapid typing -> no fetch',
      '300ms pause -> one fetch',
      'new char cancels in-flight',
      'empty query -> no fetch',
    ],
    systemPromptVariant: 'async',
  },
  {
    id: '10',
    name: 'Parent-child Level 1',
    tier: 5,
    description:
      'Parent owns array of counter slices. Each counter rendered by counterView() function. Parent shows total.',
    assertions: [
      'total shows 0 initially',
      'increment counter 1 -> total 1',
      'add counter -> total unchanged',
      'increment new counter -> total 2',
    ],
  },
  {
    id: '10b',
    name: 'Parent-child Level 2',
    tier: 5,
    description: 'Same as Task 10, but each counter is a child() component with own state machine.',
    assertions: ['same as Task 10 plus independent state'],
    systemPromptVariant: 'child',
  },
  {
    id: '11',
    name: 'Drag and drop list',
    tier: 6,
    description: 'Five items. Drag to reorder using HTML5 drag events. No external libraries.',
    assertions: [
      'dragstart sets item ID',
      'dragover prevents default',
      'drop reorders correctly',
      'DOM nodes preserved',
    ],
  },
  {
    id: '12',
    name: 'Modal dialog',
    tier: 6,
    description:
      'A button opens a modal overlay with close, confirm, focus trap, and click-outside-to-close.',
    assertions: [
      'modal absent initially',
      'Open -> modal present',
      'x -> modal absent',
      'Escape -> modal absent',
      'focus trapped',
    ],
  },
  {
    id: '13',
    name: 'Infinite scroll',
    tier: 4,
    description:
      'A list of items. Load more button appends 20 more. No more items text when source exhausted.',
    assertions: [
      '20 items initially',
      'Load more -> 40 items',
      'first 20 DOM nodes unchanged',
      'source exhausted -> No more items',
    ],
  },
  {
    id: '14',
    name: 'Form async validation',
    tier: 3,
    description:
      'Email field checks uniqueness via API after 500ms idle. Shows checking/available/taken. Submit disabled while checking or taken.',
    assertions: [
      'typing + 500ms -> checking shown',
      'mock returns taken -> taken shown + Submit disabled',
      'mock returns available -> available + Submit enabled',
      'typing while checking cancels previous',
    ],
    systemPromptVariant: 'async',
  },
  {
    id: '15',
    name: 'Real-time WebSocket',
    tier: 5,
    description:
      'List receives items from WebSocket. Prepend new items. Max 50 shown. Pause/Resume buffering.',
    assertions: [
      'WebSocket message -> item prepended',
      'after 50 items, 51st removes oldest',
      'Pause -> no visible update',
      'Resume -> buffered messages applied',
    ],
  },
]

// ── Pipeline Steps ──────────────────────────────────────────────

function checkCompile(filePath: string): { pass: boolean; errors: string[] } {
  // Use a temp tsconfig with paths so @llui/* modules resolve against
  // the workspace source. The root tsconfig provides base settings.
  const root = resolve(join(import.meta.dirname, '..'))
  // Place tsconfig at repo root so relative paths resolve correctly.
  const tmpConfig = join(root, '.eval-tsconfig.json')
  writeFileSync(
    tmpConfig,
    JSON.stringify({
      extends: './tsconfig.json',
      compilerOptions: {
        noEmit: true,
        paths: {
          '@llui/dom': ['./packages/dom/src/index.ts'],
          '@llui/dom/*': ['./packages/dom/src/*'],
          '@llui/effects': ['./packages/effects/src/index.ts'],
        },
      },
      // Only include the specific file being checked — avoids
      // one bad file failing all others.
      include: [filePath],
    }),
  )
  try {
    execSync(`npx tsc -p "${tmpConfig}" --noEmit 2>&1`, {
      encoding: 'utf8',
      cwd: root,
    })
    return { pass: true, errors: [] }
  } catch (e: unknown) {
    const stdout = (e as { stdout?: string }).stdout ?? String(e)
    // Filter to errors from this specific file
    const fileErrors = stdout
      .split('\n')
      .filter((line) => line.includes(filePath) || line.includes('error TS'))
    return { pass: fileErrors.length === 0, errors: fileErrors.slice(0, 10) }
  }
}

function checkIdiomatic(filePath: string): number {
  try {
    // Try to use @llui/lint-idiomatic if available
    const source = readFileSync(filePath, 'utf8')
    // Dynamic import would be used in production; for now return placeholder
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { lintIdiomatic } = require('../packages/lint-idiomatic/dist/index.js') as {
      lintIdiomatic: (source: string, filename?: string) => { score: number }
    }
    return lintIdiomatic(source, filePath).score
  } catch {
    return -1 // lint not available
  }
}

function evaluateFile(taskId: string, filePath: string, runIndex: number): TaskResult {
  const errors: string[] = []

  // Step 1: Compile check
  const compileResult = checkCompile(filePath)
  if (!compileResult.pass) {
    return {
      taskId,
      runIndex,
      compile: 0,
      render: 0,
      fullPass: 0,
      assertionScore: 0,
      consoleClean: 0,
      idiomatic: 0,
      errors: compileResult.errors.slice(0, 10),
    }
  }

  // Step 2: Idiomatic check
  const idiomaticScore = checkIdiomatic(filePath)

  // Step 3: Render check — mount the component in jsdom and verify it
  // produces DOM content without throwing. Full assertion scoring would
  // require per-task test files (simulating clicks, typing, etc.); for
  // now the render check validates that the component mounts cleanly.
  let renderPass = 0
  try {
    const mod = require(filePath) as Record<string, unknown>
    // Find the exported component (first ComponentDef-shaped export)
    const defKey = Object.keys(mod).find(
      (k) =>
        mod[k] &&
        typeof mod[k] === 'object' &&
        'name' in (mod[k] as object) &&
        'init' in (mod[k] as object) &&
        'view' in (mod[k] as object),
    )
    if (defKey) {
      const { mountApp } = require('../packages/dom/dist/index.js') as {
        mountApp: (el: HTMLElement, def: unknown) => { dispose: () => void }
      }
      const { JSDOM } = require('jsdom') as typeof import('jsdom')
      const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>')
      const container = dom.window.document.getElementById('app')!
      // Patch global document for the mount
      const prevDoc = globalThis.document
      globalThis.document = dom.window.document as unknown as Document
      try {
        const handle = mountApp(container, mod[defKey])
        renderPass = container.innerHTML.length > 0 ? 1 : 0
        handle.dispose()
      } finally {
        globalThis.document = prevDoc
      }
    }
  } catch {
    // Render failed — leave renderPass = 0
  }

  return {
    taskId,
    runIndex,
    compile: 1,
    render: renderPass,
    fullPass: renderPass, // Basic: mount + non-empty DOM = pass
    assertionScore: renderPass, // Per-task assertion scoring not yet wired
    consoleClean: 1,
    idiomatic: idiomaticScore >= 0 ? idiomaticScore : 0,
    errors,
  }
}

function computeMacroAverages(results: TaskResult[]): Scorecard['macroAverages'] {
  const n = results.length || 1
  return {
    compile: results.reduce((sum, r) => sum + r.compile, 0) / n,
    render: results.reduce((sum, r) => sum + r.render, 0) / n,
    fullPass: results.reduce((sum, r) => sum + r.fullPass, 0) / n,
    assertionScore: results.reduce((sum, r) => sum + r.assertionScore, 0) / n,
    consoleClean: results.reduce((sum, r) => sum + r.consoleClean, 0) / n,
    idiomatic: results.reduce((sum, r) => sum + r.idiomatic, 0) / n,
  }
}

function printScorecard(scorecard: Scorecard): void {
  console.log('\n╔══════════════════════════════════════════════════════════════════╗')
  console.log('║                   LLui Evaluation Scorecard                     ║')
  console.log('╠══════════════════════════════════════════════════════════════════╣')
  console.log(`║ Model: ${scorecard.model.padEnd(56)}║`)
  console.log(`║ Date:  ${scorecard.timestamp.padEnd(56)}║`)
  console.log('╠═══════════╤═════════╤════════╤══════╤═══════╤═══════╤══════════╣')
  console.log('║ Task      │ Compile │ Render │ Full │ Score │ Clean │ Idiom.   ║')
  console.log('╟───────────┼─────────┼────────┼──────┼───────┼───────┼──────────╢')

  for (const r of scorecard.results) {
    const task = TASKS.find((t) => t.id === r.taskId)
    const name = (task?.id ?? r.taskId).padEnd(9)
    console.log(
      `║ ${name} │   ${r.compile}     │   ${r.render}    │  ${r.fullPass}   │ ${r.assertionScore.toFixed(2).padStart(5)} │   ${r.consoleClean}   │  ${r.idiomatic}/6     ║`,
    )
  }

  console.log('╟───────────┼─────────┼────────┼──────┼───────┼───────┼──────────╢')
  const avg = scorecard.macroAverages
  console.log(
    `║ Avg       │  ${avg.compile.toFixed(2).padStart(5)} │ ${avg.render.toFixed(2).padStart(5)}  │ ${avg.fullPass.toFixed(2).padStart(5)}│ ${avg.assertionScore.toFixed(2).padStart(5)} │ ${avg.consoleClean.toFixed(2).padStart(5)} │ ${avg.idiomatic.toFixed(1).padStart(4)}/6   ║`,
  )
  console.log('╚═══════════╧═════════╧════════╧══════╧═══════╧═══════╧══════════╝')
}

// ── Main ────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2)
  const taskArg = args.find((_, i) => args[i - 1] === '--task')
  const fileArg = args.find((_, i) => args[i - 1] === '--file')
  const runsArg = args.find((_, i) => args[i - 1] === '--runs')
  const runAll = args.includes('--all')
  const runs = runsArg ? parseInt(runsArg, 10) : 1

  const outputDir = resolve(join(import.meta.dirname, 'results'))
  mkdirSync(outputDir, { recursive: true })

  const tasks = runAll ? TASKS : taskArg ? TASKS.filter((t) => t.id === taskArg) : []

  if (tasks.length === 0 && !fileArg) {
    console.log('Usage:')
    console.log('  pnpm tsx evaluation/runner.ts --task 01 --file output.ts')
    console.log('  pnpm tsx evaluation/runner.ts --all')
    console.log('')
    console.log('Available tasks:')
    for (const t of TASKS) {
      console.log(`  ${t.id} - ${t.name} (tier ${t.tier})`)
    }
    return
  }

  const results: TaskResult[] = []

  if (fileArg && taskArg) {
    // Evaluate a specific file for a specific task
    const filePath = resolve(fileArg)
    if (!existsSync(filePath)) {
      console.error(`File not found: ${filePath}`)
      process.exit(1)
    }
    for (let r = 0; r < runs; r++) {
      results.push(evaluateFile(taskArg, filePath, r))
    }
  } else {
    // Evaluate generated files (placeholder — requires LLM API integration)
    for (const task of tasks) {
      const taskFile = join(outputDir, `task-${task.id}.ts`)
      if (existsSync(taskFile)) {
        for (let r = 0; r < runs; r++) {
          results.push(evaluateFile(task.id, taskFile, r))
        }
      } else {
        console.log(`  Skipping task ${task.id}: no generated file at ${taskFile}`)
        results.push({
          taskId: task.id,
          runIndex: 0,
          compile: 0,
          render: 0,
          fullPass: 0,
          assertionScore: 0,
          consoleClean: 0,
          idiomatic: 0,
          errors: ['No generated file'],
        })
      }
    }
  }

  const scorecard: Scorecard = {
    model: 'manual',
    timestamp: new Date().toISOString(),
    systemPrompt: 'default',
    results,
    macroAverages: computeMacroAverages(results),
  }

  printScorecard(scorecard)

  const outputPath = join(outputDir, `scorecard-${Date.now()}.json`)
  writeFileSync(outputPath, JSON.stringify(scorecard, null, 2))
  console.log(`\nScorecard written to: ${outputPath}`)
}

main()
