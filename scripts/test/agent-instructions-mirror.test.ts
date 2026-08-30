import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync, readlinkSync } from 'node:fs'
import path from 'node:path'

/**
 * The repo states its agent instructions TWICE, once per agent convention:
 * `CLAUDE.md` / `.claude/skills/` and `AGENTS.md` / `.agents/skills/`. Nothing
 * gated the pair, and both halves had drifted (#258).
 *
 * `AGENTS.md` was a second hand-maintained COPY. At the commit #258 was filed
 * against it stood 137 lines behind `CLAUDE.md`, and only 9 lines were unique
 * to it — every one of them either a stale number (`Twenty-five packages`, `24
 * vitest.config.ts files`, both superseded twice over) or the residue of a
 * mechanical Claude→Codex find-and-replace that had rewritten `.claude/skills/`
 * into `.Codex/skills/`, a directory that has never existed in this repo. So
 * the file with the most authority over an agent's model of the repo was
 * pointing that agent at nothing, and the substitution that broke it was the
 * only reason the two files were separate at all.
 *
 * The skills trees had the same problem one directory over, under a gate that
 * covered 1 of their 19 files: this test's ancestor (`publish-skills.test.ts`)
 * asserted byte-identity for `publish/SKILL.md` alone, which held only because
 * that one file happens to contain neither substituted token. Measured across
 * the other 18: 13 were identical under the substitution and 5 had genuinely
 * diverged, 182 lines' worth, ALL of it `.agents/` falling behind — the whole
 * registry/styling obligation section and the `onMount`-root correction were
 * added to `.claude/skills/` and never mirrored. (14 of 19 identical overall —
 * `publish/SKILL.md`, the one file the old gate covered, is the 14th.)
 *
 * TWO different remedies, because the two pairs are not the same shape:
 *
 * - `AGENTS.md` is now a SYMLINK to `CLAUDE.md`. After rewriting the one line
 *   with an audience-dependent answer (the skills-directory sentence, which now
 *   names both trees), nothing in that file needs substituting, so the pair can
 *   be one file and the drift class stops being possible rather than being
 *   detected. This test asserts the LINK — mode, target and that the target is
 *   the real file — because a symlink silently replaced by a copy restores the
 *   exact defect with a green suite behind it. What it CANNOT help is a
 *   read-only consumer on a `core.symlinks=false` checkout (git's default on
 *   Windows without developer mode), where the link materializes as a ~10-byte
 *   regular file whose whole content is the string `CLAUDE.md`. State that
 *   consequence for THIS file and not merely its kind: a degraded
 *   `site/content` page and an `AGENTS.md` that is an EMPTY INSTRUCTION SET
 *   are not the same blast radius, and the empty one READS AS SUCCESS — an
 *   agent opens the file, gets ten bytes, and proceeds with no model of the
 *   repo and no error to attribute it to. The index assertion below catches
 *   such a file round-tripping back INTO git; nothing here can catch it on the
 *   way out. The repo already requires symlink-capable checkouts for the three
 *   `site/content/*.md` links, so this is a fourth instance of a standing
 *   requirement rather than a new one — but it is the instance that matters
 *   most, and it is REASONED, not measured: no Windows machine was available.
 * - `.agents/skills/` stays 19 REAL files. A directory symlink would be the
 *   stronger form and is deliberately not used: a file symlink is followed by
 *   any tool that opens the path at all (the OS does it), while a directory
 *   symlink is skipped by any tool that walks with `followlinks=False` — which
 *   is `os.walk`'s DEFAULT and a common shape for a skill loader. That risk is
 *   about an external tool whose behaviour cannot be measured from inside this
 *   repo, so the conservative form plus a gate is what ships. The gate asserts
 *   the mirror under the two substitutions, both directions, with the file SET
 *   pinned exactly.
 *
 * Why the checks below are STRUCTURAL and not a text scan for the corrupted
 * path: the repo's own two-occurrences trap. A guard spelled `/\.Codex/` would
 * match the prose in `CLAUDE.md`'s header that explains what went wrong, so it
 * would fail for the wrong reason here and — as an allowlist — would have gone
 * silent instead. Asserting the link and the substitution makes the corrupted
 * path unreachable by construction rather than unmatched by a regex.
 */

const ROOT = path.resolve(__dirname, '../..')

/** `CLAUDE.md`/`.claude/skills` → the `AGENTS.md`/`.agents/skills` spelling. */
const toAgents = (text: string): string =>
  text.replaceAll('.claude/skills', '.agents/skills').replaceAll('CLAUDE.md', 'AGENTS.md')

/**
 * A `CLAUDE.md`/`AGENTS.md` reference QUALIFIED by a path — `~/.claude/CLAUDE.md`,
 * `packages/x/CLAUDE.md` — as opposed to the bare repo-root one.
 *
 * `toAgents`'s `replaceAll('CLAUDE.md', 'AGENTS.md')` is unqualified, so it is
 * the corrupted-path class ONE LAYER UP from the `.Codex/skills/` defect this
 * file exists to close: a nested reference would be rewritten to a path that
 * does not exist, and — worse than the original, which nothing checked — the
 * mirror assertion would then ENFORCE the corrupted spelling, because the
 * `.agents` copy only passes if it matches the substituted text. The
 * substitution cannot be made smart enough to tell the two apart without
 * knowing what each mention MEANS, so the tripwire is the answer: today the
 * two trees hold 12 bare occurrences and ZERO qualified ones, and the day
 * someone writes a qualified one this fails and asks for a decision instead of
 * silently rewriting it.
 */
const QUALIFIED_INSTRUCTION_REF = /[\w.~/-]\/(?:CLAUDE|AGENTS)\.md/g
/** The bare repo-root spelling, which is the only one `toAgents` may rewrite. */
const BARE_INSTRUCTION_REF = /(?<![\w./-])(?:CLAUDE|AGENTS)\.md/g

/**
 * Enumerate from git — tracked plus untracked-but-not-ignored — never a
 * filesystem walk. `.claude/worktrees/` is gitignored and holds a full checkout
 * of every concurrent agent lane, so a walk rooted at `.claude` would collect
 * every sibling branch's skills as if they were this one's.
 */
function gitFiles(dir: string): string[] {
  const out = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '--', dir],
    { cwd: ROOT, encoding: 'utf8' },
  )
  return out
    .split('\n')
    .filter(Boolean)
    .map((f) => f.slice(`${dir}/`.length))
    .sort()
}

describe('AGENTS.md is a symlink to CLAUDE.md', () => {
  it('is a symlink in the working tree, pointing at CLAUDE.md', () => {
    const link = path.join(ROOT, 'AGENTS.md')
    expect(
      lstatSync(link).isSymbolicLink(),
      'AGENTS.md must be a symlink, not a copy — a copy is #258 exactly',
    ).toBe(true)
    // Relative and bare, so it resolves the same from any checkout location.
    expect(readlinkSync(link)).toBe('CLAUDE.md')
  })

  it('is recorded in git as mode 120000, so a fresh clone gets the link too', () => {
    // A working-tree-only check passes on a repo where the link was committed
    // as a regular file (which is what a Windows checkout without
    // `core.symlinks` produces on the way back in), so the index is the half
    // that actually travels.
    const entry = execFileSync('git', ['ls-files', '-s', '--', 'AGENTS.md'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim()
    expect(entry, 'AGENTS.md must be tracked').not.toBe('')
    expect(entry.split(/\s+/)[0]).toBe('120000')
    // The blob of a symlink IS its target path.
    const blob = execFileSync('git', ['cat-file', '-p', ':AGENTS.md'], {
      cwd: ROOT,
      encoding: 'utf8',
    })
    expect(blob).toBe('CLAUDE.md')
  })

  it('resolves to the real instructions rather than a dangling link', () => {
    const viaLink = readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8')
    const direct = readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8')
    expect(viaLink).toBe(direct)
    // Vacuity: an empty or truncated CLAUDE.md would satisfy the equality above.
    expect(viaLink.length).toBeGreaterThan(100_000)
    expect(viaLink).toContain('## Invariants & landmines')
  })
})

describe('.agents/skills mirrors .claude/skills', () => {
  const claude = gitFiles('.claude/skills')
  const agents = gitFiles('.agents/skills')

  it('holds the same file set, exactly, in both directions', () => {
    // EXACT equality, never a `length > N` floor: a floor detects only
    // under-collection, and the failure this pins is a new skill landing on one
    // side only, which leaves both sides non-empty.
    expect(claude.length).toBeGreaterThan(10)
    expect(agents).toEqual(claude)
  })

  it.each(claude)('%s is identical under the substitution', (rel) => {
    const src = readFileSync(path.join(ROOT, '.claude/skills', rel), 'utf8')
    const dst = readFileSync(path.join(ROOT, '.agents/skills', rel), 'utf8')
    expect(dst).toBe(toAgents(src))
  })

  it('leaves no unsubstituted token on the .agents side', () => {
    // The equality above is satisfied by a substitution that does nothing if
    // the source also contains no token, so assert the direction explicitly:
    // no `.agents/` file may name the Claude-side path or file.
    const leaks = agents.flatMap((rel) => {
      const t = readFileSync(path.join(ROOT, '.agents/skills', rel), 'utf8')
      return ['CLAUDE.md', '.claude/skills']
        .filter((tok) => t.includes(tok))
        .map((tok) => `${rel}: ${tok}`)
    })
    expect(leaks).toEqual([])
  })

  it('names no PATH-QUALIFIED CLAUDE.md/AGENTS.md, which the substitution would corrupt', () => {
    const all = [
      ...claude.map((rel) => ['.claude/skills', rel] as const),
      ...agents.map((rel) => ['.agents/skills', rel] as const),
    ]
    let bare = 0
    const qualified: string[] = []
    for (const [dir, rel] of all) {
      const text = readFileSync(path.join(ROOT, dir, rel), 'utf8')
      bare += text.match(BARE_INSTRUCTION_REF)?.length ?? 0
      for (const hit of text.match(QUALIFIED_INSTRUCTION_REF) ?? []) {
        qualified.push(`${dir}/${rel}: ${hit}`)
      }
    }
    // Vacuity: a scan that matches nothing at all would report no qualified
    // reference for the same reason it reports no bare one.
    expect(bare).toBeGreaterThan(0)
    expect(qualified).toEqual([])
  })

  it('actually exercises the substitution on at least one file', () => {
    // Vacuity guard for the two tests above: if `toAgents` were broken to an
    // identity function, every pair would still have to be byte-identical and
    // the suite would go green on a mirror it no longer checks.
    const substituted = claude.filter((rel) => {
      const src = readFileSync(path.join(ROOT, '.claude/skills', rel), 'utf8')
      return toAgents(src) !== src
    })
    expect(substituted.length).toBeGreaterThan(0)
  })
})

describe('the publish workflow both trees carry', () => {
  it('regenerates, builds, commits, and deploy-verifies llui.dev', () => {
    for (const owner of ['.claude', '.agents']) {
      const skill = readFileSync(path.join(ROOT, owner, 'skills/publish/SKILL.md'), 'utf8')
      expect(skill).toContain('pnpm --filter @llui/site generate')
      expect(skill).toContain('pnpm --filter @llui/site build')
      expect(skill).toContain('site/content/api')
      expect(skill).toContain('site/public/llms.txt')
      expect(skill).toContain('site/public/llms-full.txt')
      expect(skill).toContain('.github/workflows/deploy-docs.yml')
      expect(skill).toContain('https://llui.dev')
    }
  })
})
