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

`bench:setup` also applies and fixture-verifies the repository's narrow Chrome
150 compatibility patch: trace parsing ignores buffered events before
`TracingStartedInBrowser`. The pinned upstream parser otherwise counts warm-up
clicks as measured clicks for long-running setup phases.

The entrypoint verifies Node, pnpm, and Chrome before doing any setup. It then
performs a frozen workspace install, refreshes and verifies the pinned JFB
checkout, applies the ticker harness patches, and executes `bench:all`. The
combined runner rebuilds the complete benchmark dependency graph before either
suite, so both consume current `dist/` output without building unrelated apps.
Before standard-suite measurement it also installs every selected upstream
competitor from that framework's package lock and builds its production entry
point. A fail-closed compatibility rewrite removes the pinned Elm manifest's
undeclared `elm-tooling` bootstrap and explicitly permits only its locked Elm
compiler install script.
Setup and measurement run as the unprivileged `node` user; Chrome uses its
user-namespace and renderer sandboxes inside the container.

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

## Homelab use

The homelab benchmark is deliberately not CI. From the PVE host, run the
on-demand action maintained by `homelab-ops`:

```bash
llui-benchmark -- --framework llui --runs 1
llui-benchmark --branch main --commit -- --runs 5 --save
```

Action options precede the required `--`; every argument after it is forwarded
as one unchanged `bench:all` argv element. The action fetches the latest commit
of the selected branch, creates a clean checkout in VM 101, and launches this
one-shot container. Image layers, package downloads, and the verified JFB
checkout are cached; no benchmark process or service remains running.

All four organization Actions runners share VM 101. The PVE action waits for
them to become idle and temporarily pauses them while measuring. Normal cleanup
and an independent Docker watchdog both restore every runner owned by the
action. Reports are retained on VM 101 and copied with SHA-256 verification to
PVE. `--commit` requires a complete `--save` capture and pushes only the three
canonical generated outputs to the same branch that was measured.
