# On-demand benchmark container

This is the reproducible execution layer for the standard and ticker suites. It
is a one-shot `docker run --rm`, not a service. The repository is mounted
read-write because a complete `--save` capture must update the canonical
baseline and its generated site outputs.

## Pinned environment

The image fixes every environment input that materially affects a capture:

- Linux/amd64 Node `24.14.1` base image by manifest digest
- Debian packages from the `2026-08-16` snapshot
- Chrome for Testing `150.0.7871.46` by archive SHA-256
- pnpm `10.33.0`
- js-framework-benchmark by [`../jfb-revision.txt`](../jfb-revision.txt)
- repository dependencies by `pnpm-lock.yaml`

The entrypoint verifies Node, pnpm, and Chrome before doing any setup. It then
performs a frozen workspace install, refreshes and verifies the pinned JFB
checkout, applies the ticker harness patches, and executes `bench:all`.

Named Docker volumes cache pnpm/npm downloads and the JFB checkout. They are
data caches, not running services; setup still verifies the JFB pin and every
installed dependency before measurement.

## Local use

Docker must be running.

```bash
pnpm bench:container:smoke
pnpm bench:container -- --framework llui --runs 1
pnpm bench:container -- --runs 5 --save
```

Every argument after the script name remains one argv element—there is no shell
reconstruction. The same subset and publication rules as `bench:all` apply. In
particular, `--save` requires a clean checkout and cannot be combined with
`--framework` or `--only`.

The cache volumes can be discarded without losing results:

```bash
docker volume rm llui-benchmark-pnpm llui-benchmark-npm llui-benchmark-jfb
```

## Homelab workflow

Run **Homelab benchmarks** from GitHub Actions. `arguments_json` is a JSON array
of the exact `bench:all` argv, for example:

```json
["--framework", "llui", "--only", "batch-1k", "--runs", "1"]
```

This representation is intentional: a free-form shell string cannot preserve
argument boundaries safely. `publish_baseline` must agree with `--save`.
Publishing is accepted only from `main` and pushes the three canonical outputs
to `benchmark-baseline/<run-id>` for review. It never pushes measured values
directly to `main`.

The Linux homelab has four Actions runners on one VM. The workflow waits for
the three sibling runners to become idle, pauses them, then starts the benchmark
container. A temporary watchdog and an `always()` cleanup both unpause them;
the watchdog is the backstop for a hard-cancelled Actions job. No runner is
recreated or restarted.

The live runner workdir is not host-visible, so the workflow clones the exact
triggering commit into the existing `/ci-cache` bind mount before invoking the
sibling container. This avoids the empty-workspace failure mode documented in
the homelab runner topology without changing the fleet.
