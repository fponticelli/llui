# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Canonical label   | Label in our tracker | Meaning                                  |
| ----------------- | -------------------- | ---------------------------------------- |
| `needs-triage`    | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`      | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent` | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human` | `ready-for-human`    | Requires human implementation            |
| `wontfix`         | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

Edit the right-hand column to match whatever vocabulary you actually use.

## Repo state

Of these five, only `wontfix` exists on `fponticelli/llui` today (it ships with every GitHub repo). The other four are created on first use — `gh label create <name>` — since `gh issue edit --add-label` fails on an unknown label.

These are orthogonal to the repo's existing topic labels (`bug`, `enhancement`, `audit`, `tech-debt`, `performance`, `components`, `a11y`, `pattern`, `new-component`, `documentation`): topic labels say _what_ an issue is about, triage labels say _what state_ it's in. An issue normally carries one of each.
