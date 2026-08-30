import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettierConfig from 'eslint-config-prettier'
import globals from 'globals'

/**
 * The LLui linting baseline.
 *
 * As of the lint→compiler migration, all framework-specific lint rules
 * (correctness, agent-protocol, conventions) emit as compile-time
 * errors via `@llui/compiler` through `@llui/vite-plugin`. The former
 * `@llui/eslint-plugin` package was deleted; this config keeps only
 * the universal TS/JS lint baseline.
 *
 * If a future need arises for editor-time squiggles on the same rules,
 * the right path is an LSP wrapper around the compiler's diagnostics
 * rather than re-deriving the same checks in eslint rule form.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/*.d.ts',
      '**/*.prototype.ts', // scratch/prototype files — excluded from build, check, and lint
      '**/__fixtures__/**',
      'benchmarks/js-framework-benchmark-repo/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    // `scripts/` — the repo's own build tooling (#256).
    //
    // `pnpm turbo lint` runs the `lint` task PER WORKSPACE PACKAGE and the repo
    // root is not a workspace member, so before this block nothing linted these
    // 66 `.ts`/`.mjs` files at all. The root `lint:scripts` script is what
    // REACHES them (and `scripts/test/lint-scripts-coverage.test.ts` pins that
    // invocation, because a config nothing runs is exactly #252's shape one
    // gate over); this block is what decides the RULE SET they meet.
    //
    // It is TYPE-AWARE, which the packages' set deliberately is not, and that
    // asymmetry is the point rather than an oversight. #252 closed the
    // type-checking half here and its CI comment states what it left open in as
    // many words: that gate "is a TYPE gate, not an `any` ban: `JSON.parse`
    // returns `any` and `scripts/` has ~38 call sites [...] Banning them needs
    // ESLint, which still does not run here (#256)". The `no-unsafe-*` family
    // IS that ban, and it pays for itself here specifically: `scripts/` is where
    // the guards live, it reaches its `.mjs` helpers across a boundary that was
    // untyped until #252, and the documented failure mode of that boundary is a
    // drift surfacing as a runtime `undefined` INSIDE an assertion — which can
    // pass. Stopping `any` from propagating out of `JSON.parse`, `page.evaluate`
    // and a dynamic `import()` is what catches that class before it is written.
    //
    // MEASURED against the PRE-FIX sources (`git checkout main -- scripts/`,
    // 65 files), by deriving each probe from THIS file and swapping only the
    // preset in this block — so the corpus and every other setting are held
    // fixed. Errors are load-independent; wall times were taken at load ~220
    // and the ratio is the trustworthy part.
    //
    //   rule set                              errors  files  wall   ratio
    //   the repo baseline (this block off)         2      2  2.0 s   1.0x
    //   recommendedTypeChecked                    95     25  5.6 s   2.8x  <- shipped
    //   strictTypeChecked                        317     43  5.8 s   2.9x
    //
    // Two things that decomposition disproves and that an earlier draft of this
    // comment got wrong. Raising `no-explicit-any` to error below contributes
    // ZERO — the preset already sets it to error, and the one site that would
    // have fired carried an inline disable, so the shipped number is 95 either
    // way; the override is future-proofing, not a finding. And the baseline row
    // is 2 where a measurement of "the block on, preset swapped to
    // `recommended`" gives 3 — both correct, for different configs. The extra
    // error is `prefer-const` on `publish-order.mjs`, and the cause is the
    // `files` GLOB, not the preset. Measured with `--print-config`:
    // `prefer-const` is scoped to TS extensions in the baseline, so a `.ts`
    // under `scripts/` resolves it with this block deleted, while a `.mjs` does
    // not — and naming `.mjs` in the glob below pulls those files into that
    // TS-scoped baseline under EITHER preset. Worth knowing generally: adding
    // `.mjs` to a `files`-scoped block widens the baseline rule set for those
    // files independently of the preset chosen for them.
    //
    // `strictTypeChecked` is rejected on its CONTENT, not its count. Of its 222
    // marginal errors, 116 are `restrict-template-expressions` (118 total, 2 of
    // which already fire above) and 73 are `no-non-null-assertion` — `${count}`
    // inside a console.log, and `import.meta.dirname!` in a script that cannot
    // run outside Node. The remaining 33 are the interesting ones and they are
    // worse: the 10 `no-unnecessary-condition` hits are the rule being WRONG
    // about runtime validation (`baseline.schemaVersion !== 1` guarding a
    // `JSON.parse` cast; `cur !== undefined` walking `ts.Node.parent`, whose
    // root parent IS undefined at runtime). Adopting it would put pressure on
    // deleting real defences, which is a worse outcome than the count suggests.
    //
    // The `project` is `tsconfig.scripts.json` — the SAME program
    // `pnpm check:scripts` compiles, so the two gates cannot disagree about what
    // a file's types are, and its `checkJs` is what makes the `.mjs` half
    // type-aware at all. Scoping the whole block behind `files` keeps every
    // workspace package non-type-aware, so `pnpm turbo lint` is unchanged.
    files: ['scripts/**/*.ts', 'scripts/**/*.mjs'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.scripts.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // An ERROR here where the baseline warns. A warning is not a gate — this
      // repo's standing position is that "LLMs (and humans in a hurry) ignore
      // warnings", which is why every framework rule is a build error — and the
      // whole point of the `no-unsafe-*` family above is that `any` must not
      // flow. Leaving `any` writable by hand while banning its propagation is a
      // gate with a documented way through it. Two sites existed when this
      // landed and both were replaced with real types.
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
)
