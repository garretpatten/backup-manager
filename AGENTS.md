# Agent instructions

TypeScript backup tooling: per-service backup jobs under `src/` (GitHub code,
GitLab mirrors, Notion, browser bookmarks, Obsidian notes, Google Calendar, Tasks,
Contacts, and Photos), thin Bash wrappers per service, a Vitest suite under
`__tests__/`, and an orchestrator (`run-all`). There is no application runtime;
all I/O (HTTP, fs, git, archives) sits behind interfaces in `src/types.ts`.

This repository graduated from the `backups` module of
[garretpatten/system-scripts](https://github.com/garretpatten/system-scripts),
which consumes it as a git submodule at `backups/`.

## Repository standards

[garretpatten/github-standards](https://github.com/garretpatten/github-standards) is the
**canonical source of truth** for how every `garretpatten` repository must be structured
and maintained: license, security policy, contributing, community files, README
branding, CODEOWNERS, branch protection, pull requests, signed commits, Dependabot,
dependency hygiene, secret hygiene, workflow permissions, action pinning, repository
metadata, CI and quality, and exceptions.

- **Before starting any task**, read the current standards from the source of truth
  rather than from memory or a cached copy — they change over time. The standards index
  is at <https://github.com/garretpatten/github-standards#standards-files>; fetch raw
  files from
  `https://raw.githubusercontent.com/garretpatten/github-standards/master/<standard>.md`
  (via web fetch, `curl`, or `gh api`) and read every standard relevant to the task.
- **While working**, apply the standards to every change: workflows, dependency files,
  community files, repository metadata, and commit practices must conform to the
  standards as they exist at the time of the change.
- **When you detect drift** — this repository lagging behind a standard that changed —
  bring the repository back in line as part of normal work and call it out in your
  summary. If an update would be large or ambiguous, propose it instead of applying it
  silently.
- **Before finishing**, confirm the work satisfies the
  [verification](https://github.com/garretpatten/github-standards/blob/master/verification.md)
  standard and that local checks pass.
- For a full compliance review, use the `github-audit` skill, which audits a repository
  against these standards and reports numbered findings.

## Before you finish

Do **not** consider work complete until local checks pass. Run from the
repository root:

```bash
npm install
npm run lint
npm test
npm run typecheck
```

Or run the same checks step by step:

```bash
npx prettier --check .
npx markdownlint-cli2 "**/*.md" "#node_modules"
yamllint .github .yamllint .markdownlint.yaml
actionlint
npx vitest run
npx tsc --noEmit
```

**Fix failures instead of ignoring them** when practical:

- Prettier: `npx prettier --write .` (or only the paths you changed), then re-run
  `npx prettier --check .`.
- Markdown/YAML: correct the files per the rule messages, then re-run until
  clean.
- ESLint: `npx eslint src __tests__` covers the TypeScript tree.

| If you edited              | Also run                                                         |
| -------------------------- | ---------------------------------------------------------------- |
| `.github/workflows/*.yaml` | `yamllint .github .yamllint .markdownlint.yaml` and `actionlint` |
| Any `*.md`                 | `markdownlint-cli2` on those paths or `npm run lint:markdown`    |
| YAML or workflow files     | `npm run lint:yaml`                                              |
| Any `*.ts`                 | `npm test` and `npm run typecheck`                               |
| Any `*.sh`                 | `shellcheck` on the touched wrappers                             |

Install missing tools as needed:

| Tool       | Example install           |
| ---------- | ------------------------- |
| actionlint | `brew install actionlint` |
| yamllint   | `pip install yamllint`    |
| shellcheck | `brew install shellcheck` |

CI **Quality Checks** runs PR-scoped linters via `garretpatten/quality-checks`.
CI **Security Guardrails** runs OpenGrep, TruffleHog, and supply-chain scans. CI
**Codeowners Enforcer** requires every changed file to have an owner in
`.github/CODEOWNERS` (or an entry in `.github/.codeownersignore`). CI **Tests**
runs Vitest and `tsc --noEmit`.

## Layout

| Path                                                     | Role                                                     |
| -------------------------------------------------------- | -------------------------------------------------------- |
| `src/`                                                   | Backup implementations, API clients, shared helpers      |
| `__tests__/unit/`                                        | Vitest unit tests with mocked I/O                        |
| `code/`, `notion/`, …                                    | Thin Bash wrappers around the `src/` entry points        |
| `run-all.sh`                                             | Orchestrator wrapper (`src/run-all.ts`)                  |
| `logs/`                                                  | Runtime logs (gitignored)                                |
| `.env.example`                                           | Documented environment variables                         |
| `.github/workflows/`                                     | Tests plus quality, security, and CODEOWNERS enforcement |
| `vitest.config.ts`, `tsconfig.json`, `eslint.config.mjs` | Test, type, and lint configuration                       |

## Conventions (TypeScript)

- All I/O goes through the interfaces in `src/types.ts` (`FileSystem`, `HttpClient`,
  `GitRepository`, `Archive`, `Logger`, …); entry points wire the real
  implementations in `src/backup-context.ts`, tests wire the mocks in
  `__tests__/test-helpers.ts`.
- Entry points resolve paths via `resolveModuleRoot()` (module root: `src/..`,
  where `logs/` lives) and `resolveProjectRoot()` (configuration root: the
  repository root standalone, or the consuming repository root when mounted as a
  submodule). Do not hard-code either.
- Entry points read configuration from `.env` in the project root and from the
  environment; never hard-code tokens, absolute user paths, or machine-specific
  values.
- Fails loudly: a backup that cannot complete logs errors and exits non-zero
  instead of writing empty exports.
- Match the naming, logging, and error style of neighboring modules.

## Conventions (shell)

- Wrappers stay thin: resolve the module root, `cd` there, and exec
  `npx tsx src/<entry>.ts`. Keep `set -euo pipefail` and quote expansions.

## Submodule consumers

When this repository is mounted as a submodule (for example at
`system-scripts/backups`), `.env` is read from the consuming repository root and
`GOOGLE_REFRESH_TOKEN` is saved there; logs are written to the submodule's `logs/`
directory. Consumers keep their own `npm run backup:*` delegates that exec into
the submodule. Preserve both behaviors when touching `src/backup-context.ts`.

## Commits

Only commit when the user asks. Do not commit secrets. Sign every commit; the
`CI` ruleset rejects unsigned pushes to `master`.

## GitHub Actions

Whenever a GitHub workflow is added, all GitHub Action pins in that workflow
should be updated to point to the full-length commit SHA of the most recent
release.
