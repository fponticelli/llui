/**
 * Build every example mini-app and copy its static output into the site's
 * deploy directory so the apps are served at `/apps/<slug>/`.
 *
 * Each app is built with base `/apps/<slug>/` so its asset URLs resolve under
 * that sub-path inside the iframe. Builds go to an out-of-tree staging dir —
 * never the example's own `dist/` — so the root-based `dist/` that `preview`,
 * `bench`, and `scripts/smoke-examples.ts` rely on is left untouched.
 *
 * The framing doc pages are produced separately by `generate-examples.ts`.
 *
 * Run AFTER `vite build` (it writes into `dist/client`):
 *   tsx src/build-examples.ts
 */
import { execFileSync } from 'child_process'
import { cpSync, existsSync, rmSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { EXAMPLES } from './examples-data'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const projectRoot = resolve(root, '..')
const appsOutDir = resolve(root, 'dist/client/apps')
const stagingRoot = resolve(root, 'dist/.apps-staging')

const failures: string[] = []

for (const ex of EXAMPLES) {
  const base = `/apps/${ex.slug}/`
  const dest = resolve(appsOutDir, ex.slug)
  const staging = resolve(stagingRoot, ex.slug)
  console.log(`\n▶ Building ${ex.slug} (base=${base})`)
  try {
    rmSync(staging, { recursive: true, force: true })

    if (ex.vike) {
      // Vike's CLI wrapper rejects Vite's `--base`/`--outDir` flags, so both are
      // passed via env vars its vite.config.ts reads. Vike writes the browser
      // bundle to `<LLUI_OUT>/client`.
      execFileSync('pnpm', ['--filter', ex.pkg, 'exec', '--', 'vite', 'build'], {
        cwd: projectRoot,
        stdio: 'inherit',
        env: { ...process.env, LLUI_BASE: base, LLUI_OUT: staging },
      })
    } else {
      // Plain Vite SPA: base + an out-of-tree outDir. `--emptyOutDir` is required
      // because the outDir sits outside the example's root.
      execFileSync(
        'pnpm',
        [
          '--filter',
          ex.pkg,
          'exec',
          '--',
          'vite',
          'build',
          '--base',
          base,
          '--outDir',
          staging,
          '--emptyOutDir',
        ],
        { cwd: projectRoot, stdio: 'inherit' },
      )
    }

    const built = ex.vike ? resolve(staging, 'client') : staging
    if (!existsSync(built)) {
      throw new Error(`expected build output at ${built} but it does not exist`)
    }

    rmSync(dest, { recursive: true, force: true })
    mkdirSync(dirname(dest), { recursive: true })
    cpSync(built, dest, { recursive: true })
    console.log(`✓ Copied ${ex.slug} → dist/client/apps/${ex.slug}`)
  } catch (err) {
    console.error(`✗ Failed to build ${ex.slug}: ${(err as Error).message}`)
    failures.push(ex.slug)
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

rmSync(stagingRoot, { recursive: true, force: true })

if (failures.length > 0) {
  console.error(`\nExample build failed for: ${failures.join(', ')}`)
  process.exit(1)
}

console.log(`\nBuilt + copied ${EXAMPLES.length} example apps into dist/client/apps`)
