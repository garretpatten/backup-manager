<!-- markdownlint-disable MD033 MD041 -->

<p align="center">
    <img src="https://img.shields.io/badge/backup--manager-1d4ed8?style=for-the-badge&logo=github&logoColor=white&labelColor=0f172a" alt="backup-manager project badge" />
</p>

<h1 align="center">Backup Manager</h1>

<p align="center"><strong>Backup tooling for personal code, notes, bookmarks, and Google services.</strong></p>

<p align="center">
  TypeScript backup jobs run individually or through one orchestrator, on macOS/Linux,<br />
  exporting dated local archives and optional external-drive copies.
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/github/license/garretpatten/backup-manager?style=flat-square" alt="License" /></a>
  <img src="https://img.shields.io/badge/runtime-Node.js%2024%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js 24 or newer" />
  <img src="https://img.shields.io/badge/language-TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
</p>

<p align="center">
  <a href="https://github.com/garretpatten/backup-manager/actions/workflows/tests.yaml"
      ><img src="https://img.shields.io/github/actions/workflow/status/garretpatten/backup-manager/tests.yaml?branch=master&label=tests&logo=github&style=flat-square" alt="Tests workflow status"
  /></a>
  <a href="https://github.com/garretpatten/backup-manager/actions/workflows/quality-checks.yaml"
      ><img src="https://img.shields.io/github/actions/workflow/status/garretpatten/backup-manager/quality-checks.yaml?branch=master&label=quality&logo=github&style=flat-square" alt="Quality checks workflow status"
  /></a>
  <a href="https://github.com/garretpatten/backup-manager/actions/workflows/security-guardrails.yaml"
      ><img src="https://img.shields.io/github/actions/workflow/status/garretpatten/backup-manager/security-guardrails.yaml?branch=master&label=security&logo=github&style=flat-square" alt="Security guardrails workflow status"
  /></a>
</p>

<!-- markdownlint-enable MD033 MD041 -->

---

## Overview

Backup Manager backs up code repositories, Notion workspaces, browser bookmarks,
Obsidian notes, and Google Calendar, Tasks, Contacts, and Photos into dated local
archives. Each service backup is an independent job with its own shell wrapper and
`npm run backup:*` entry point; `run-all` orchestrates them in one unattended pass.
The implementation is TypeScript with all I/O behind mockable interfaces, so the
backup logic is unit-testable without real API calls or git operations.

This project graduated from the `backups` module of
[garretpatten/system-scripts](https://github.com/garretpatten/system-scripts), which
now consumes it as a git submodule at `backups/` with the same `npm run backup:*`
entry points. Checked out standalone, this repository is self-contained; mounted as
a submodule, configuration (`.env`) is read from the consuming repository root and
logs land in the submodule's `logs/` directory, exactly as before the extraction.

## Features

- **Code backups**: local zipped clones of all non-archived GitHub repositories and
  full mirrors pushed to GitLab, with cleanup of stale GitLab mirrors
- **Notion export**: all accessible pages and databases as Markdown in nested
  folders mirroring the workspace, zipped per run
- **Browser bookmarks**: Brave and Chrome bookmarks converted to Netscape HTML with
  dated JSON copies
- **Obsidian notes**: the `~/Notes/` vault zipped with its folder structure intact
- **Google Calendar, Tasks, and Contacts**: complete JSON exports via read-only
  OAuth scopes, zipped per run, with a one-time interactive authorization flow that
  stores the refresh token for unattended runs
- **Google Photos**: Takeout archive download with resume and verification, merged
  into a flat, deduplicated library tracked by a SHA-256 state manifest
- **Spotify export** (deprecated, disabled by default): user profile plus
  every playlist with its tracks and metadata as JSON, zipped per run, with a
  one-time OAuth authorization helper
- **Todoist export** (deprecated, disabled by default): every task, project,
  and label as JSON via the REST v1 API, zipped per run and failing loudly
  on fetch errors
- **Orchestration**: `run-all` executes the steps listed in `backups.json`
  sequentially, skips disabled steps and steps missing credentials, and
  reports per-step status with combined logging

## Project structure

- **`src/`** — TypeScript source code
  - `local-backup.ts` — Local GitHub repository backup
  - `gitlab-mirror.ts` — GitHub to GitLab mirror
  - `gitlab-mirror-cleanup.ts` — Remove stale GitLab mirrors
  - `notion-backup.ts` — Notion Markdown export
  - `brave-bookmarks-backup.ts` — Brave bookmarks HTML/JSON export
  - `chrome-bookmarks-backup.ts` — Chrome bookmarks HTML/JSON export
  - `obsidian-notes-backup.ts` — Obsidian notes zip backup
  - `google-calendar-backup.ts` — Google Calendar export
  - `google-tasks-backup.ts` — Google Tasks export
  - `google-contacts-backup.ts` — Google Contacts export
  - `google-photos-backup.ts` — Google Photos Takeout backup (download,
    extract, merge)
  - `spotify-backup.ts` — Spotify profile and playlist export (deprecated)
  - `spotify-auth.ts` — Spotify OAuth 2.0 token refresh and one-time
    authorization helper (deprecated)
  - `todoist-backup.ts` — Todoist tasks/projects/labels export (deprecated)
  - `run-all.ts` — Config-driven orchestrator running the steps listed in
    `backups.json`
  - `backup-config.ts` — `backups.json` resolution, parsing, and validation
  - `backup-steps.ts` — Registry of orchestrated step descriptors (name,
    required credentials, kind, config assembly)
  - `github.ts`, `gitlab.ts`, `notion.ts`, `spotify.ts`, `todoist.ts` — API clients
  - `google-calendar.ts`, `google-tasks.ts`, `google-contacts.ts` — Google API clients
  - `google-auth.ts` — Shared Google OAuth 2.0 token refresh
  - `google-photos-download.ts`, `google-photos-takeout.ts`,
    `google-photos-state.ts`, `google-photos-merge.ts`,
    `google-photos-media-fs.ts` — Google Photos Takeout pipeline modules
  - `logger.ts`, `env.ts`, `fs.ts`, `http.ts`, `git.ts`, `archive.ts`,
    `export-dir.ts` — shared abstractions
- **`__tests__/unit/`** — Vitest unit tests with mocked I/O
- **`code/`** — Backward-compatible shell wrappers
  - `code-backup-local.sh` — Thin wrapper around `local-backup.ts`
  - `code-backup-gitlab.sh` — Thin wrapper around `gitlab-mirror.ts`
  - `code-backup-gitlab-cleanup.sh` — Thin wrapper around `gitlab-mirror-cleanup.ts`
- **`notion/`** — Backward-compatible shell wrapper
  - `notion-backup.sh` — Thin wrapper around `notion-backup.ts`
- **`brave-bookmarks/`** — Backward-compatible shell wrapper
  - `brave-bookmarks-backup.sh` — Thin wrapper around `brave-bookmarks-backup.ts`
- **`chrome-bookmarks/`** — Backward-compatible shell wrapper
  - `chrome-bookmarks-backup.sh` — Thin wrapper around `chrome-bookmarks-backup.ts`
- **`obsidian-notes/`** — Backward-compatible shell wrapper
  - `obsidian-notes-backup.sh` — Thin wrapper around `obsidian-notes-backup.ts`
- **`google-calendar/`** — Backward-compatible shell wrapper
  - `google-calendar-backup.sh` — Thin wrapper around
    `google-calendar-backup.ts`
- **`google-tasks/`** — Backward-compatible shell wrapper
  - `google-tasks-backup.sh` — Thin wrapper around `google-tasks-backup.ts`
- **`google-contacts/`** — Backward-compatible shell wrapper
  - `google-contacts-backup.sh` — Thin wrapper around `google-contacts-backup.ts`
- **`google-photos/`** — Google Photos Takeout backup
  - `google-photos-backup.sh` — Thin wrapper around `google-photos-backup.ts`
- **`spotify/`** — Deprecated Spotify backup wrappers
  - `spotify-backup.sh` — Thin wrapper around `spotify-backup.ts`
  - `spotify-auth.sh` — Thin wrapper around `spotify-auth.ts`
- **`todoist/`** — Deprecated Todoist backup wrapper
  - `todoist-backup.sh` — Thin wrapper around `todoist-backup.ts`
- **`run-all.sh`** — Thin wrapper around `run-all.ts`
- **`backups.json`** — Committed orchestrator configuration: the ordered
  list of backup steps and their enable state

## Running Tests

The test suite uses Vitest with mocked HTTP, file-system, git, and archive
clients so no real API calls or git operations are performed.

```bash
npm test
```

Run the TypeScript compiler in check-only mode:

```bash
npm run typecheck
```

---

## Requirements

The backups module is implemented in TypeScript and runs on Node.js. The original
shell entry points are now thin wrappers around the TypeScript implementation.

- Node.js 20+
- `npm` (or `pnpm`/`yarn`)
- Bash shell (version 4.0+) for the wrapper scripts

**Code backups also require:**

- `git`
- `zip` (local backup only)

**Notion and Google backups also require:**

- `zip`

### Installing Dependencies

**Node.js dependencies:**

```bash
npm install
```

**System dependencies (macOS using Homebrew):**

```bash
brew install git curl zip
```

**Ubuntu/Debian:**

```bash
sudo apt update
sudo apt install git curl zip
```

**CentOS/RHEL:**

```bash
sudo yum install git curl zip
```

---

## Export Archives & External Drive Copy

All zip-producing backups (`code`, `notion`, `obsidian-notes`,
`google-calendar`, `google-tasks`, `google-contacts`, and — when enabled —
the deprecated `spotify` and `todoist`) write their zips into a dated
directory instead of directly into the home directory:

- **Local**: `~/Exports/Exports_YYYY-MM-DD/`
- **External drive**: when a drive labeled `T7 Shield` is mounted, each zip is
  also copied to `<mount>/Garret/Exports/Exports_YYYY-MM-DD/`
  (`/Volumes/T7 Shield/...` on macOS,
  `/run/media/<user>/T7 Shield/...` on Linux). Set
  `EXTERNAL_DRIVE_EXPORT_SUBPATH` (e.g. `Backup/Archives`) to override the
  `Garret/Exports` subpath on the drive.

The drive is located by volume label at the usual mount points; the label
directory must exist as a directory at one of those locations and is trusted
as-is. The mount is probed once per process run and the result is reused by all
backups in that run. If the drive is not attached, the local archive is still
written and the external copy is skipped with a warning. If the external copy
fails, the backup continues — the local archive is the source of truth.
Existing dated `Exports_*` directories are never cleaned up automatically.

---

## Environment Variables

Copy `.env.example` to `.env` in the project root and fill in your tokens:

```bash
cp .env.example .env
```

All backup scripts automatically load `.env` from the project root when present.
You can also export variables in your shell instead.

### Code backups

```bash
# Optional: access private GitHub repos
GITHUB_TOKEN="your_github_token"

# Optional: auto-detected if GITHUB_TOKEN is provided
GITHUB_USERNAME="your-username"

# Optional: use SSH for GitHub clones (default: false)
USE_GITHUB_SSH="false"
```

### GitLab mirror

```bash
# Required
GITLAB_TOKEN="your_gitlab_pat"
GITLAB_NAMESPACE="your-username"

# Optional
AUTO_CREATE_GITLAB_PROJECTS="true"
GITLAB_VISIBILITY="private"
GITLAB_HOST="https://gitlab.com"
BACKUP_ROOT="$HOME/GitHub-GitLab-Backup"
```

### Notion backup

```bash
# Required
NOTION_API_TOKEN="your_notion_integration_token"
```

To create a Notion integration token, visit
**Notion Settings & members → Integrations → Develop your own → New integration**.
After creating the integration, you must share each page or database you want to
export with the integration from its **Share** menu. The Notion API can only
access content explicitly shared with the integration.

### Google Calendar, Google Tasks, and Google Contacts backups

All Google backups share the same OAuth 2.0 credentials:

```bash
# Required
GOOGLE_CLIENT_ID="your_google_oauth_client_id"
GOOGLE_CLIENT_SECRET="your_google_oauth_client_secret"

# Required for `npm run backup:all`; filled in automatically by the first
# interactive run of an individual Google backup (see below)
GOOGLE_REFRESH_TOKEN=""

# Optional
GOOGLE_CALENDAR_SHOW_DELETED="false"
GOOGLE_TASKS_SHOW_COMPLETED="true"
GOOGLE_TASKS_SHOW_DELETED="true"
GOOGLE_TASKS_SHOW_HIDDEN="true"
```

Create an OAuth 2.0 **Desktop app** client in the
[Google Cloud Console](https://console.cloud.google.com/apis/credentials) and
enable the **Google Calendar API**, **Google Tasks API**, and **People API**
for the project.

You do not need to create a refresh token yourself. The first time you run a
Google backup individually (`npm run backup:google-calendar`,
`npm run backup:google-tasks`, or `npm run backup:google-contacts`), the
script starts a local listener, prints a
Google consent URL to open in your browser, and exchanges the authorization
for a refresh token that is saved to `.env`. The consent requests these
read-only scopes:

- `https://www.googleapis.com/auth/calendar.readonly`
- `https://www.googleapis.com/auth/contacts.other.readonly`
- `https://www.googleapis.com/auth/contacts.readonly`
- `https://www.googleapis.com/auth/tasks.readonly`

(`contacts.other.readonly` covers the auto-saved "Other contacts" that
`contacts.readonly` alone cannot read.)

**Note:** The OAuth app itself may be configured with broader permissions,
but these backups deliberately request only the read-only scopes above and
perform no writes to Google Calendar, Google Tasks, or Google Contacts. Do not
broaden `GOOGLE_BACKUP_SCOPES` in `src/google-auth.ts` to match the app.

**Existing installs — one-time re-authorization:** the saved
`GOOGLE_REFRESH_TOKEN` was granted before the contacts scopes were added, so
People API calls fail with `403 ... insufficient scopes` until you
re-authorize once. Remove `GOOGLE_REFRESH_TOKEN` from `.env` and run
`npm run backup:google-contacts` in an interactive terminal; the consent flow
re-requests all four scopes and saves the new token automatically.

Subsequent runs — including `npm run backup:all` and cron jobs — reuse the
saved token and run unattended. Until the token is saved, an orchestrated run
skips the Google steps as `SKIPPED (no credentials)` rather than starting the
interactive flow. If the refresh token is revoked or expires, `backup:all`
automatically re-runs the browser authorization flow (up to three attempts)
and saves the new token to `.env`. If you are not present to approve the
prompt, the authorization times out and the backup fails gracefully so the
rest of the orchestrated backups continue.

### Spotify backup (deprecated)

The Spotify module is ported from the retired standalone
[spotify-backup-tool](https://github.com/garretpatten/spotify-backup-tool) and
is disabled by default (`"enabled": false` in `backups.json`). Create an app
in the [Spotify developer dashboard](https://developer.spotify.com/dashboard)
to get the client credentials; use `http://127.0.0.1` as the redirect URI
(the helper binds an ephemeral loopback port).

```bash
# Required
SPOTIFY_CLIENT_ID="your_spotify_app_client_id"
SPOTIFY_CLIENT_SECRET="your_spotify_app_client_secret"

# Required; obtained by the one-time authorization helper below
SPOTIFY_REFRESH_TOKEN=""

# Optional tuning (defaults shown; the API caps playlists at 50, tracks at 100)
PLAYLIST_LIMIT="50"
TRACK_LIMIT="100"
```

You do not need to create a refresh token yourself. Run `npm run
auth:spotify` (or `./spotify/spotify-auth.sh`) once in an interactive
terminal: the helper starts a local listener, prints a Spotify consent URL
to open in your browser, and saves the refresh token to `.env`. The consent
requests only read scopes:

- `playlist-read-private`
- `playlist-read-collaborative`
- `user-library-read`
- `user-read-email`
- `user-read-private`

**Note:** a refresh token can rot (expire or be revoked) while the module
sits disabled — re-run the auth helper when you enable the step. Unlike the
Google modules, the orchestrated run never starts the interactive flow; a
dead token fails the step loudly instead.

### Todoist backup (deprecated)

The Todoist module is restored from `system-scripts` history and is disabled
by default (`"enabled": false` in `backups.json`).

```bash
# Required
TODOIST_API_TOKEN="your_todoist_api_token"
```

Create the token at **Todoist Settings → Integrations → Developer**. The
client speaks the current REST v1 API (`https://api.todoist.com/api/v1`,
cursor pagination, up to 200 items per page), but it has not been smoke-tested
against a live account since the restore — verify a standalone run works
before enabling the step in `backups.json`.

### Google Photos backup

The Google Photos backup does **not** use OAuth or the Photos Library API.
Google removed the `photoslibrary.readonly` scope in March 2025, so the only
sanctioned way to export an existing library is
[Google Takeout](https://takeout.google.com). This backup automates everything
after you request the export:

```bash
# Required for --mode download or --mode full: the download links from your
# Takeout export email ("Your Google data is ready"), comma-separated
GOOGLE_PHOTOS_TAKEOUT_URLS="https://takeout.googleapis.com/...,https://takeout.googleapis.com/..."

# Optional: defaults shown
GOOGLE_PHOTOS_SLICES_DIR="$HOME/Downloads/google-photos-takeout"
GOOGLE_PHOTOS_TARGET_DIR="$HOME/Pictures/Google Photos"
```

No API keys are required, and this backup is **not** part of `npm run
backup:all` because Takeout exports are generated by hand and expire after
about a week.

---

## Local Code Backup (`code/code-backup-local.sh`)

Creates a local, zipped directory of all your non-archived GitHub repositories.

### Local Backup Features

- Fetches all non-archived repositories from your GitHub account
- Clones new repositories or updates existing ones to their latest default branch
- Creates a zip backup: `~/Exports/Exports_YYYY-MM-DD/Code-Export_YYYY-MM-DD.zip`
- Excludes `.git` directories and system files from the zip archive

### Local Backup Usage

```bash
./code/code-backup-local.sh
```

Or via npm:

```bash
npm run backup:code-local
```

### Local Backup Output

- **Local repositories**: `~/Code-Export_YYYY-MM-DD/`
- **Backup archive**: `~/Exports/Exports_YYYY-MM-DD/Code-Export_YYYY-MM-DD.zip`
- **Logs**: `logs/code-backup-YYYYMMDD-HHMMSS.log`
- **Errors**: `logs/errors-YYYYMMDD-HHMMSS.log`

---

## GitLab Code Mirror (`code/code-backup-gitlab.sh`)

Mirrors all non-archived GitHub repositories to GitLab.

### GitLab Mirror Features

- Lists all non-archived GitHub repos you can access
- Creates/updates a local mirror clone (bare repo) for each
- Ensures a same-named GitLab project exists under your namespace
- Pushes all branches and tags to GitLab (GitHub's internal `refs/pull/*`
  refs are excluded)
- Self-heals GitLab protected branches that reject the mirror's force push
  (temporarily enables "Allowed to force push" for the push, then restores it)
- Automatically cleans up mirrors for repos that are archived or deleted on GitHub

### GitLab Mirror Usage

```bash
./code/code-backup-gitlab.sh
```

Or via npm:

```bash
npm run backup:code-gitlab
```

### How It Works

1. Fetches all non-archived repositories from GitHub
2. For each repository:
   - Creates/updates a local bare mirror clone
   - Checks if a GitLab project exists (creates it if
     `AUTO_CREATE_GITLAB_PROJECTS=true`)
   - Pushes all branches and tags to GitLab as a mirror (excluding GitHub's
     internal `refs/pull/*` refs)
3. Runs cleanup to remove mirrors for repos that are archived or no longer
   exist on GitHub

### Output

- **Local mirrors**: `$BACKUP_ROOT/mirrors/` (bare repos, reused across runs)
- **Logs**: `logs/gh-gl-backup-YYYYMMDD-HHMMSS.log`
- **Errors**: `logs/gh-gl-errors-YYYYMMDD-HHMMSS.log`

---

## GitLab Mirror Cleanup (`code/code-backup-gitlab-cleanup.sh`)

Removes GitLab mirrors when their corresponding GitHub repository is archived or deleted.

### GitLab Mirror Cleanup Features

- Lists all GitHub repos, including archived ones
- Lists all projects in the configured GitLab namespace
- Deletes GitLab projects whose matching GitHub repo is archived or missing
- Skips cleanup if no GitHub repos are found, preventing accidental mass deletion

### GitLab Mirror Cleanup Usage

Run manually:

```bash
./code/code-backup-gitlab-cleanup.sh
```

Or via npm:

```bash
npm run backup:code-gitlab-cleanup
```

The cleanup also runs automatically as the final step of `backup:code-gitlab`.

### Cleanup Behavior

1. Fetches all repositories from GitHub (active and archived)
2. Fetches all projects in the configured GitLab namespace
3. For each GitLab project:
   - Keeps the project if a non-archived GitHub repo with the same name
     (raw or slugified, e.g. "My Repo" -> "my-repo") exists
   - Deletes the project if the matching GitHub repo is archived
   - Deletes the project if no matching GitHub repo exists

### Cleanup Output

- **Logs**: `logs/gh-gl-cleanup-YYYYMMDD-HHMMSS.log`
- **Errors**: `logs/gh-gl-cleanup-errors-YYYYMMDD-HHMMSS.log`

---

## Notion Workspace Export (`notion/notion-backup.sh`)

Exports all pages and databases the integration can access as Markdown files in
nested folders that mirror the workspace structure.

### Notion Export Features

- Discovers pages and databases shared with the integration
- Builds a nested folder structure based on parent/child relationships
- Exports each page as a Markdown file with headings, lists, checkboxes, code
  blocks, quotes, and other basic blocks
- Exports each database as a Markdown file listing its entries and properties
- Ignores toggle block wrappers (their children are exported inline)
- Fails loudly: pages or databases that cannot be exported are logged as
  errors and the run exits non-zero instead of writing empty exports
- Creates a zip backup: `~/Exports/Exports_YYYY-MM-DD/Notion-Export_YYYY-MM-DD.zip`

### Notion Export Limitations

- The integration must be added to every page or database you want to export.
  Private content that is not shared with the integration will not be included.
- Advanced or proprietary Notion block types are rendered as comments or simple
  placeholders.
- Export speed is intentionally throttled to respect Notion API rate limits.

### Notion Export Usage

```bash
./notion/notion-backup.sh
```

Or via npm:

```bash
npm run backup:notion
```

### Notion Export Output

- **Backup archive**: `~/Exports/Exports_YYYY-MM-DD/Notion-Export_YYYY-MM-DD.zip`
- **Logs**: `logs/notion-backup-YYYYMMDD-HHMMSS.log`
- **Errors**: `logs/notion-errors-YYYYMMDD-HHMMSS.log`

---

## Brave Bookmarks Export (`brave-bookmarks/brave-bookmarks-backup.sh`)

Converts the Brave Browser bookmarks file to Netscape Bookmark File Format HTML
and optionally keeps a dated JSON copy of the original profile data.

### Brave Bookmarks Export Features

- Detects the Brave bookmarks file on Linux or macOS
- Warns if Brave appears to be running (the file may be locked or stale)
- Converts the Chromium bookmarks JSON to valid Netscape HTML
- Preserves folder hierarchy and basic metadata (name, URL, dates)
- Leaves the original Brave profile data untouched
- Creates a dated JSON copy of the original file alongside the HTML export

### Brave Bookmarks Export Usage

```bash
./brave-bookmarks/brave-bookmarks-backup.sh
```

Or via npm:

```bash
npm run backup:brave-bookmarks
```

### Brave Bookmarks Export Output

- **HTML export**: `~/brave-bookmarks_YYYY-MM-DD.html`
- **JSON copy**: `~/brave-bookmarks_YYYY-MM-DD.json`
- **Logs**: `logs/brave-bookmarks-backup-YYYYMMDD-HHMMSS.log`

---

## Chrome Bookmarks Export (`chrome-bookmarks/chrome-bookmarks-backup.sh`)

Converts the Google Chrome bookmarks file to Netscape Bookmark File Format HTML
and optionally keeps a dated JSON copy of the original profile data.

### Chrome Bookmarks Export Features

- Detects the Chrome bookmarks file on Linux or macOS
- Warns if Chrome appears to be running (the file may be locked or stale)
- Converts the Chromium bookmarks JSON to valid Netscape HTML
- Preserves folder hierarchy and basic metadata (name, URL, dates)
- Leaves the original Chrome profile data untouched
- Creates a dated JSON copy of the original file alongside the HTML export

### Chrome Bookmarks Export Usage

```bash
./chrome-bookmarks/chrome-bookmarks-backup.sh
```

Or via npm:

```bash
npm run backup:chrome-bookmarks
```

### Chrome Bookmarks Export Output

- **HTML export**: `~/chrome-bookmarks_YYYY-MM-DD.html`
- **JSON copy**: `~/chrome-bookmarks_YYYY-MM-DD.json`
- **Logs**: `logs/chrome-bookmarks-backup-YYYYMMDD-HHMMSS.log`

---

## Obsidian Notes Export (`obsidian-notes/obsidian-notes-backup.sh`)

Backs up the Obsidian notes vault stored at `~/Notes/`.

### Obsidian Notes Export Features

- Copies the entire `~/Notes/` directory preserving folder structure
- Creates a zip backup: `~/Exports/Exports_YYYY-MM-DD/Obsidian-Notes_YYYY-MM-DD.zip`
- Exits gracefully with a helpful message when `~/Notes/` is not found

### Obsidian Notes Export Requirements

The Obsidian notes vault must be located at:

```text
$HOME/Notes/
```

If that directory is not found, the script logs a warning and exits without
creating an archive.

### Obsidian Notes Export Usage

```bash
./obsidian-notes/obsidian-notes-backup.sh
```

Or via npm:

```bash
npm run backup:obsidian-notes
```

### Obsidian Notes Export Output

- **Backup archive**: `~/Exports/Exports_YYYY-MM-DD/Obsidian-Notes_YYYY-MM-DD.zip`
- **Logs**: `logs/obsidian-notes-backup-YYYYMMDD-HHMMSS.log`

---

## Google Calendar Export (`google-calendar/google-calendar-backup.sh`)

Exports all calendars visible to the authenticated user — including secondary
and shared calendars with at least reader access — together with their events.

### Google Calendar Export Features

- Guides you through a one-time Google authorization on first run and saves
  the refresh token to `.env`
- Discovers all calendars via the Calendar API (handles pagination)
- Exports every event per calendar, expanding recurring events into instances
- Optionally includes deleted/cancelled events
  (`GOOGLE_CALENDAR_SHOW_DELETED="true"`)
- Writes pretty-printed JSON files to a temporary directory
- Fails loudly: calendars whose events cannot be exported are logged as
  errors and the run exits non-zero instead of writing empty exports
- Creates a zip backup: `~/Exports/Exports_YYYY-MM-DD/Google-Calendar-Export_YYYY-MM-DD.zip`

### Google Calendar Export Usage

```bash
./google-calendar/google-calendar-backup.sh
```

Or via npm:

```bash
npm run backup:google-calendar
```

### Google Calendar Export Output

- **Backup archive**: `~/Exports/Exports_YYYY-MM-DD/Google-Calendar-Export_YYYY-MM-DD.zip`
- **Logs**: `logs/google-calendar-backup-YYYYMMDD-HHMMSS.log`
- **Errors**: `logs/google-calendar-errors-YYYYMMDD-HHMMSS.log`

The zip contains a `calendars.json` index plus one directory per calendar with
`calendar.json` (metadata) and `events.json` (all events).

---

## Google Tasks Export (`google-tasks/google-tasks-backup.sh`)

Exports all task lists and tasks belonging to the authenticated user.

### Google Tasks Export Features

- Guides you through a one-time Google authorization on first run and saves
  the refresh token to `.env`
- Discovers all task lists via the Tasks API (handles pagination)
- Exports every task per list, including completed, deleted, and hidden tasks
  (configurable via `GOOGLE_TASKS_SHOW_COMPLETED`, `GOOGLE_TASKS_SHOW_DELETED`,
  and `GOOGLE_TASKS_SHOW_HIDDEN`)
- Writes pretty-printed JSON files to a temporary directory
- Fails loudly: task lists whose tasks cannot be exported are logged as
  errors and the run exits non-zero instead of writing empty exports
- Creates a zip backup: `~/Exports/Exports_YYYY-MM-DD/Google-Tasks-Export_YYYY-MM-DD.zip`

### Google Tasks Export Usage

```bash
./google-tasks/google-tasks-backup.sh
```

Or via npm:

```bash
npm run backup:google-tasks
```

### Google Tasks Export Output

- **Backup archive**: `~/Exports/Exports_YYYY-MM-DD/Google-Tasks-Export_YYYY-MM-DD.zip`
- **Logs**: `logs/google-tasks-backup-YYYYMMDD-HHMMSS.log`
- **Errors**: `logs/google-tasks-errors-YYYYMMDD-HHMMSS.log`

The zip contains a `task-lists.json` index plus one directory per task list
with `task-list.json` (metadata) and `tasks.json` (all tasks).

---

## Google Contacts Export (`google-contacts/google-contacts-backup.sh`)

Exports every contact in the authenticated user's Google account, including
the labels (contact groups) index and the auto-saved "Other contacts".

### Google Contacts Export Features

- Guides you through a one-time Google authorization on first run and saves
  the refresh token to `.env`
- Exports every contact with all People API fields, including group
  memberships, so per-contact label membership is recoverable
- Exports the contact groups (labels) index and the "Other contacts"
  auto-saved by Gmail and Chat interactions
- Includes contact photos as metadata only: the photo URLs inside the JSON
  are captured, but the image bytes are not downloaded, and People API photo
  URLs are short-lived
- Writes pretty-printed JSON files to a temporary directory
- Fails loudly: collections that cannot be exported are logged as errors and
  the run exits non-zero instead of writing an empty export
- Creates a zip backup: `~/Exports/Exports_YYYY-MM-DD/Google-Contacts-Export_YYYY-MM-DD.zip`

### Google Contacts Export Usage

```bash
./google-contacts/google-contacts-backup.sh
```

Or via npm:

```bash
npm run backup:google-contacts
```

### Google Contacts Export Output

- **Backup archive**: `~/Exports/Exports_YYYY-MM-DD/Google-Contacts-Export_YYYY-MM-DD.zip`
- **Logs**: `logs/google-contacts-backup-YYYYMMDD-HHMMSS.log`
- **Errors**: `logs/google-contacts-errors-YYYYMMDD-HHMMSS.log`

The zip contains three flat JSON files (no per-contact or per-label
directories):

- `contacts.json` — every contact from `people/me/connections`, all fields
  including group memberships
- `contact-groups.json` — the labels / contact groups index
- `other-contacts.json` — the auto-saved "Other contacts"

---

## Google Photos Backup (`google-photos/google-photos-backup.sh`)

Downloads a [Google Takeout](https://takeout.google.com) export of your Google
Photos library and merges it into a flat, deduplicated local directory. This is
a user-initiated backup (not part of `npm run backup:all`) because Takeout
export archives must be requested by hand and expire after about a week.

### Google Photos Backup Features

- Downloads every Takeout slice URL with resume support (`Range` requests keep
  `.part` progress across interrupted runs), exponential-backoff retries, and
  `Content-Length` verification
- Skips slices that are already fully downloaded
- Extracts `.zip`/`.tgz` slices via the system `tar`/`unzip` binaries
- Merges media into the target library, deduplicating by SHA-256 content hash —
  both within a run and against previous runs via a state manifest — so a
  repeat export months later only copies new photos
- Resolves filename collisions with `_1`, `_2` suffixes (same behavior as
  `media-scripts/flatten-photos.sh`)
- Records titles, capture timestamps, camera make/model, descriptions, and
  source albums in `.google-photos-state.json` inside the target directory
- Supports full, download-only, and merge-only runs plus dry-run previews

### Google Photos Backup Prerequisites

If you have never used Google Takeout before, follow these steps once per
export (roughly every six months):

1. Sign in to [takeout.google.com](https://takeout.google.com) with the Google
   account that holds your photos.
2. Click **Deselect all**, then scroll down and check **Google Photos**.
3. Click the button **All photo albums included** and make sure every album is
   checked, then click **OK**.
4. Click **Next step**. Choose:
   - **Send download link via email** as the delivery method
   - **Export once** as the frequency
   - **.zip** as the file type
   - **50 GB** as the archive size (largest available — fewer slices to
     download)
5. Click **Create export**. Google builds the archive in the background — for
   large libraries this takes hours to days. You can close the page; you will
   get an email when it is ready.
6. When the **"Your Google data is ready"** email arrives, open it and copy
   every download link it contains (right-click each download button and pick
   **Copy link address**). The same links are listed at
   [takeout.google.com](https://takeout.google.com) under **Previous exports**.
   They expire about a week after the export finishes.
7. Paste the links, comma-separated, into `GOOGLE_PHOTOS_TAKEOUT_URLS` in the
   project's `.env` file (copy the line from `.env.example` and fill in the
   URLs between the quotes).

Run the backup (below) before the links expire. To download manually instead,
place the archive files from the email into the slices directory yourself and
use `--mode merge`.

Remember the request again roughly every six months; the pipeline handles the
rest incrementally.

### Google Photos Backup Usage

```bash
# Full pipeline using GOOGLE_PHOTOS_TAKEOUT_URLS from .env (recommended)
npm run backup:google-photos

# One-shot with links passed inline instead of .env
./google-photos/google-photos-backup.sh --urls "https://takeout.googleapis.com/...,https://takeout.googleapis.com/..."

# Download slices only (run merge later, e.g. when disks are slower)
./google-photos/google-photos-backup.sh --mode download

# Merge archives already downloaded manually into the slices directory
./google-photos/google-photos-backup.sh --mode merge

# Preview without touching the target directory
./google-photos/google-photos-backup.sh --mode merge --dry-run

# Also keep the Takeout .json metadata files next to the media
./google-photos/google-photos-backup.sh --mode merge --keep-json
```

`GOOGLE_PHOTOS_TAKEOUT_URLS` must be set in `.env` (or passed via `--urls`)
for download runs; the directories can also be adjusted with
`GOOGLE_PHOTOS_SLICES_DIR` and
`GOOGLE_PHOTOS_TARGET_DIR` in `.env` (defaults:
`~/Downloads/google-photos-takeout` and `~/Pictures/Google Photos`).

### Google Photos Backup Output

- **Photo library**: `<target>/` — a flat, deduplicated copy of every photo and
  video in the library, plus the `.google-photos-state.json` manifest
- **Archives**: `<slices>/` — downloaded Takeout slices (kept for re-merge)
- **Logs**: `logs/google-photos-backup-YYYYMMDD-HHMMSS.log`
- **Errors**: `logs/google-photos-errors-YYYYMMDD-HHMMSS.log`

### Google Photos Backup Caveats

- Takeout preserves original filenames and original quality; note that Google
  strips GPS data from photo EXIF metadata in the JSON sidecars
- Live albums are not kept in sync: album names are recorded in the state
  manifest metadata only, not recreated on disk
- Edited photos and motion photos arrive as separate files and are handled as
  independent content by the deduplication logic
- Exports expire after about a week; download slices before the links expire

---

## Spotify Backup (`spotify/spotify-backup.sh`)

> **Deprecated and disabled by default.** The step is registered in the
> orchestrator but ships as `"enabled": false` in `backups.json`; `npm run
backup:all` reports it as `SKIPPED (disabled)`. The standalone commands
> below bypass `backups.json` and always run.

Exports the user profile and every playlist of the authenticated user —
metadata plus full track listings — as JSON files, zipped into the dated
export directory. Ported from the retired standalone
[spotify-backup-tool](https://github.com/garretpatten/spotify-backup-tool)
onto this repository's interfaces with zero runtime dependencies (no
`spotify-web-api-node`, `archiver`, `dotenv`, or `fs-extra`).

### Spotify Backup Features

- Guides you through a one-time Spotify authorization via
  `npm run auth:spotify` (or `./spotify/spotify-auth.sh`) and saves the
  refresh token to `.env`; the first standalone `npm run backup:spotify`
  run also offers the same flow when no token is saved
- Exports the user profile as `profile.json`
- Exports every playlist (public and private, including collaborative ones
  visible to the account) with its tracks and metadata, one JSON file per
  playlist under `public/` or `private/`
- Preserves the original tool's track projection: name, artists, album
  (with release date and cover images), external URLs, duration, explicit
  flag, popularity, preview URL, and track/disc numbers
- Continues exporting the remaining playlists when one playlist fails and
  exits non-zero, so a partial export is never mistaken for success
- Creates a zip backup: `~/Exports/Exports_YYYY-MM-DD/Spotify-Export_YYYY-MM-DD.zip`

### Spotify Backup Usage

```bash
./spotify/spotify-backup.sh
```

Or via npm:

```bash
npm run backup:spotify
```

To (re)authorize first:

```bash
./spotify/spotify-auth.sh
# or
npm run auth:spotify
```

### Spotify Backup Output

- **Backup archive**: `~/Exports/Exports_YYYY-MM-DD/Spotify-Export_YYYY-MM-DD.zip`
- **Logs**: `logs/spotify-backup-YYYYMMDD-HHMMSS.log`
- **Errors**: `logs/spotify-errors-YYYYMMDD-HHMMSS.log`

The zip contains `profile.json` plus `public/` and `private/` directories
with one JSON file per playlist.

---

## Todoist Backup (`todoist/todoist-backup.sh`)

> **Deprecated and disabled by default.** The step is registered in the
> orchestrator but ships as `"enabled": false` in `backups.json`; `npm run
backup:all` reports it as `SKIPPED (disabled)`. The standalone commands
> below bypass `backups.json` and always run.

Exports every Todoist task, project, and label as JSON files, zipped into
the dated export directory. Restored from `system-scripts` git history
(the module was removed there in commit `e1a6d2c`).

### Todoist Backup Features

- Paginates through the REST v1 API (`https://api.todoist.com/api/v1`) with
  the maximum page size of 200 and cursor-based continuation
- Writes `tasks.json`, `projects.json`, and `labels.json` into a dated
  export directory
- Fails loudly: a failed tasks, projects, or labels fetch fails the whole
  run — the old module swallowed project and label errors and wrote empty
  arrays, so a dead token produced an empty, successful-looking backup
- Stores the zip via the shared export-directory convention instead of
  dropping it in the home directory like the old module did
- Creates a zip backup: `~/Exports/Exports_YYYY-MM-DD/Todoist-Export_YYYY-MM-DD.zip`

### Todoist Backup Usage

```bash
./todoist/todoist-backup.sh
```

Or via npm:

```bash
npm run backup:todoist
```

### Todoist Backup Output

- **Backup archive**: `~/Exports/Exports_YYYY-MM-DD/Todoist-Export_YYYY-MM-DD.zip`
- **Logs**: `logs/todoist-backup-YYYYMMDD-HHMMSS.log`
- **Errors**: `logs/todoist-errors-YYYYMMDD-HHMMSS.log`

### Todoist Backup Caveats

- The restored client speaks the current cursor-based REST v1 pagination,
  but it has not been smoke-tested against a live Todoist account since the
  restore. Run it standalone once and check the output before enabling the
  step in `backups.json`.

---

## Run All Backups

To run every orchestrated backup in one unattended pass:

```bash
./run-all.sh
```

Or via npm:

```bash
npm run backup:all
npm run backups
```

The orchestrator is config-driven: the step list, execution order, and
enable/disable state come from `backups.json` (below), while each step's
credentials and module settings come from `.env` and the environment. It runs
the steps sequentially, captures each backup's output in a combined log, and
reports the status of every step in a summary: `OK`, `FAILED`,
`SKIPPED (disabled)`, or `SKIPPED (no credentials)`. The run exits non-zero
when any executed step fails. The `code-gitlab` step includes the automatic
mirror cleanup.

### backups.json

The committed `backups.json` at the repository root is the single
configuration mechanism for the orchestrator — an ordered list of steps, each
with an `enabled` flag:

```json
{
  "version": 1,
  "modules": [
    { "name": "code-local", "enabled": true },
    { "name": "code-gitlab", "enabled": true }
  ]
}
```

- **Ordering**: steps run in the order listed. The file is the only source of
  execution order; environment variables remain for credentials and
  per-module settings only.
- **Disabling a step**: set `"enabled": false` for an optional or deprecated
  step. The step never runs, its credentials are never checked, and the
  summary reports `SKIPPED (disabled)`.
- **Resolution**: `backups.json` is resolved exactly like `.env` (see
  `resolveProjectRoot()` in `src/backup-context.ts`): a copy at the project
  root — the consuming repository when this repo is mounted as a submodule,
  for example `system-scripts/backups` — wins wholesale over the committed
  module-root file, with no per-key merging. Submodule consumers thereby get
  a per-deployment enable state without dirtying the submodule working tree.
- **Validation**: the orchestrator fails loudly before running anything when
  the file is malformed, uses an unknown `version`, is missing at both
  resolution locations, lists a step name that is not in the registry (a typo
  or version drift), or omits a registered step — explicit listing is
  required, so there are no silent defaults.

### Orchestrated steps and credentials

The eleven orchestrated steps and the credentials each requires:

| Step               | Required credentials                                                  |
| ------------------ | --------------------------------------------------------------------- |
| `code-local`       | none (`GITHUB_TOKEN` optional for private repositories)               |
| `code-gitlab`      | `GITLAB_TOKEN`, `GITLAB_NAMESPACE`                                    |
| `notion`           | `NOTION_API_TOKEN`                                                    |
| `brave-bookmarks`  | none                                                                  |
| `chrome-bookmarks` | none                                                                  |
| `obsidian-notes`   | none                                                                  |
| `google-calendar`  | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`    |
| `google-tasks`     | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`    |
| `google-contacts`  | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`    |
| `spotify`          | `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REFRESH_TOKEN` |
| `todoist`          | `TODOIST_API_TOKEN`                                                   |

The `spotify` and `todoist` steps are deprecated modules: both are
registered above but ship disabled (`"enabled": false`) in the committed
`backups.json`, so an orchestrated run reports them as `SKIPPED (disabled)`
without checking credentials. Flip the flag in your project-root
`backups.json` to re-enable either one; the standalone
`npm run backup:spotify` and `npm run backup:todoist` scripts bypass
`backups.json` entirely and always run.

An enabled step whose credentials are unset or empty is skipped with a
warning — `SKIPPED (no credentials)` — instead of failing with confusing API
errors. That includes the Google steps, which need the saved
`GOOGLE_REFRESH_TOKEN` (run an individual Google backup once interactively to
create it; a revoked or expired token still triggers the automatic
re-authorization flow described above).

The two skip conditions are distinct signals for a cron operator:
`SKIPPED (disabled)` is intentional, while `SKIPPED (no credentials)` is a
misconfiguration to fix.

### Steps that are not orchestrated

`backups.json` lists the eleven orchestrated steps only. These are not registry
steps, by design:

- `google-photos` — user-initiated: Takeout exports are requested by hand and
  expire after about a week, so a cron step would always fail.
- `gitlab-mirror-cleanup` — a composite tail of the `code-gitlab` step (also
  runnable standalone via `npm run backup:code-gitlab-cleanup`).

---

## Logging

All scripts create detailed logs in `logs/`:

**Local Backup:**

- `code-backup-YYYYMMDD-HHMMSS.log`
- `errors-YYYYMMDD-HHMMSS.log`

**GitLab Mirror:**

- `gh-gl-backup-YYYYMMDD-HHMMSS.log`
- `gh-gl-errors-YYYYMMDD-HHMMSS.log`

**GitLab Mirror Cleanup:**

- `gh-gl-cleanup-YYYYMMDD-HHMMSS.log`
- `gh-gl-cleanup-errors-YYYYMMDD-HHMMSS.log`

**Notion Export:**

- `notion-backup-YYYYMMDD-HHMMSS.log`
- `notion-errors-YYYYMMDD-HHMMSS.log`

**Brave Bookmarks Export:**

- `brave-bookmarks-backup-YYYYMMDD-HHMMSS.log`

**Chrome Bookmarks Export:**

- `chrome-bookmarks-backup-YYYYMMDD-HHMMSS.log`

**Obsidian Notes Export:**

- `obsidian-notes-backup-YYYYMMDD-HHMMSS.log`

**Google Calendar Export:**

- `google-calendar-backup-YYYYMMDD-HHMMSS.log`
- `google-calendar-errors-YYYYMMDD-HHMMSS.log`

**Google Tasks Export:**

- `google-tasks-backup-YYYYMMDD-HHMMSS.log`
- `google-tasks-errors-YYYYMMDD-HHMMSS.log`

**Google Contacts Export:**

- `google-contacts-backup-YYYYMMDD-HHMMSS.log`
- `google-contacts-errors-YYYYMMDD-HHMMSS.log`

**Google Photos Backup:**

- `google-photos-backup-YYYYMMDD-HHMMSS.log`
- `google-photos-errors-YYYYMMDD-HHMMSS.log`

**Spotify Export:**

- `spotify-backup-YYYYMMDD-HHMMSS.log`
- `spotify-errors-YYYYMMDD-HHMMSS.log`

**Todoist Export:**

- `todoist-backup-YYYYMMDD-HHMMSS.log`
- `todoist-errors-YYYYMMDD-HHMMSS.log`

**Orchestrator:**

- `backups-YYYYMMDD-HHMMSS.log`

Logs include:

- Timestamped entries
- Color-coded output levels (INFO, SUCCESS, WARNING, ERROR)
- Detailed error messages
- Progress tracking
- Summary statistics

---

## Troubleshooting

### Common Issues

1. **"Missing required dependencies"**
   - Install missing tools using the commands above

2. **"Failed to fetch repositories from GitHub API"**
   - Check your internet connection
   - Verify GitHub API access
   - For private repos, ensure `GITHUB_TOKEN` is set correctly

3. **"Could not determine default branch"**
   - Repository might be empty or have no branches
   - Check repository permissions

4. **"Failed to clone/update repository"**
   - Check repository permissions
   - Verify SSH keys or authentication tokens
   - Check error log for specific details

5. **GitLab: "Could not find GitLab namespace"**
   - Verify `GITLAB_NAMESPACE` is set correctly
   - Ensure your GitLab token has proper permissions
   - Check that the namespace exists (username or group)

6. **GitLab: "Failed to push mirror"**
   - Verify `GITLAB_TOKEN` has `write_repository` scope
   - Check that the GitLab project exists or auto-create is enabled
   - Protected branches: GitLab protects a project's default branch by default
     and blocks force pushes to it. A mirror push must force-update a branch
     whenever its history has been rewritten upstream, so the script
     temporarily enables "Allowed to force push" for the affected branches
     via the Protected Branches API and restores the setting afterwards
     (requires the `api` scope; each flip-and-restore is logged)
   - Review error log for specific GitLab API errors

7. **Notion: "Set NOTION_API_TOKEN"**
   - Add your Notion integration token to `.env`
   - Ensure the integration has not been deleted or restricted

8. **Notion: "No pages or databases found"**
   - Share the pages and databases you want to export with your integration
   - The Notion API cannot access private content automatically

9. **Notion: "Notion API error"**
   - Check your internet connection
   - Verify the token is valid
   - Confirm the integration has access to the requested content
   - Review `logs/notion-errors-*.log` for details

10. **Brave Bookmarks: "Brave bookmarks file not found"**
    - Ensure Brave has been launched at least once so the profile directory exists
    - Check that the bookmarks file exists at
      `~/.config/BraveSoftware/Brave-Browser/Default/Bookmarks` (Linux) or
      `~/Library/Application Support/BraveSoftware/Brave-Browser/Default/Bookmarks`
      (macOS)

11. **Brave Bookmarks: "Brave appears to be running"**
    - This is a warning, not a fatal error
    - Close Brave and re-run the backup to ensure the bookmarks file is not locked

12. **Brave Bookmarks: "Failed to parse Brave bookmarks JSON"**
    - The Brave profile may be corrupted or the file may be partially written
    - Close Brave and try again
    - Review `logs/brave-bookmarks-backup-*.log` for details

13. **Chrome Bookmarks: "Chrome bookmarks file not found"**
    - Ensure Chrome has been launched at least once so the profile directory exists
    - Check that the bookmarks file exists at
      `~/.config/google-chrome/Default/Bookmarks` (Linux) or
      `~/Library/Application Support/Google/Chrome/Default/Bookmarks` (macOS)

14. **Chrome Bookmarks: "Chrome appears to be running"**
    - This is a warning, not a fatal error
    - Close Chrome and re-run the backup to ensure the bookmarks file is not locked

15. **Chrome Bookmarks: "Failed to parse Chrome bookmarks JSON"**
    - The Chrome profile may be corrupted or the file may be partially written
    - Close Chrome and try again
    - Review `logs/chrome-bookmarks-backup-*.log` for details

16. **Google: "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET"**
    - Add your Google OAuth 2.0 Desktop app credentials to `.env`

17. **Google: "SKIPPED (no credentials)" for the Google steps in `backup:all`**
    - The saved `GOOGLE_REFRESH_TOKEN` is missing (or `GOOGLE_CLIENT_ID` /
      `GOOGLE_CLIENT_SECRET` are unset)
    - Run `npm run backup:google-calendar`, `npm run backup:google-tasks`,
      or `npm run backup:google-contacts` once in an interactive terminal to
      complete the browser authorization; the token is saved to `.env`
      automatically

18. **Google: "Google OAuth token refresh failed"**
    - The saved refresh token may have been revoked or the OAuth client
      regenerated; `backup:all` now tries the interactive re-authorization flow
      automatically (up to three attempts) and saves the new token to `.env`
    - You can also remove `GOOGLE_REFRESH_TOKEN` from `.env` and run an
      individual Google backup once to re-authorize
    - Ensure the authorization was granted the `calendar.readonly`,
      `contacts.other.readonly`, `contacts.readonly`, and `tasks.readonly`
      scopes
    - Review `logs/google-calendar-errors-*.log`,
      `logs/google-tasks-errors-*.log`, or
      `logs/google-contacts-errors-*.log` for details

19. **Google: "Timed out waiting for Google authorization"**
    - Re-run the backup and complete the consent in your browser within five
      minutes; unattended `backup:all` runs will time out and continue with the
      remaining backups

20. **Google Contacts: "Request had insufficient authentication scopes"**
    - The saved refresh token predates the contacts scopes; remove
      `GOOGLE_REFRESH_TOKEN` from `.env` and run
      `npm run backup:google-contacts` once interactively to re-authorize
    - Also confirm the **People API** is enabled for the OAuth project in the
      Google Cloud Console
    - Review `logs/google-contacts-errors-*.log` for details

21. **Spotify: "Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET"**
    - Add your Spotify app credentials to `.env` (see the Spotify backup
      section above), then run `npm run auth:spotify` once interactively to
      save the refresh token

22. **Spotify: "Spotify OAuth token refresh failed"**
    - The saved refresh token has expired or been revoked — it can rot while
      the module sits disabled; re-run `npm run auth:spotify` to re-authorize
    - Review `logs/spotify-errors-*.log` for details

23. **Todoist: "Todoist API error"**
    - Verify `TODOIST_API_TOKEN` in `.env` (Todoist Settings → Integrations →
      Developer)
    - A failed tasks/projects/labels fetch fails the run by design; review
      `logs/todoist-errors-*.log` for details

### Getting Help

Check the error log files for detailed error messages:

```bash
cat logs/errors-*.log
cat logs/gh-gl-errors-*.log
cat logs/notion-errors-*.log
```

---

## Automation

To run these scripts automatically, you can set up cron jobs:

```bash
# Edit crontab
crontab -e

# Run all backups daily at 2 AM
0 2 * * * cd /path/to/backup-manager && npm run backup:all

# Run individual backups
0 2 * * * cd /path/to/backup-manager && npm run backup:code-local
0 3 * * 0 cd /path/to/backup-manager && npm run backup:code-gitlab
0 4 * * * cd /path/to/backup-manager && npm run backup:notion
0 5 * * * cd /path/to/backup-manager && npm run backup:brave-bookmarks
0 6 * * * cd /path/to/backup-manager && npm run backup:chrome-bookmarks
0 7 * * * cd /path/to/backup-manager && npm run backup:obsidian-notes
0 8 * * * cd /path/to/backup-manager && npm run backup:google-calendar
0 9 * * * cd /path/to/backup-manager && npm run backup:google-tasks
0 10 * * * cd /path/to/backup-manager && npm run backup:google-contacts

# Google Photos backups are user-initiated (a fresh Takeout must be requested
# by hand, roughly twice a year), so there is no cron entry for them. When a
# new export is ready, set GOOGLE_PHOTOS_TAKEOUT_URLS in .env and run:
#   ./google-photos/google-photos-backup.sh --mode full
#
# The deprecated spotify and todoist modules ship disabled in backups.json;
# there is no cron entry for them either. Run them standalone only when
# needed, after setting their credentials:
#   npm run backup:spotify   # requires SPOTIFY_* credentials
#   npm run backup:todoist   # requires TODOIST_API_TOKEN
```

**Note:** When using cron, make sure environment variables are available in
`.env` in the project root, or source them before running the script.

---

## Notes

### Repository Filtering

Code backup scripts only process **non-archived** repositories. Archived
repositories are automatically excluded.

### Private Repositories

- **Local backup**: Requires `GITHUB_TOKEN` to access private repos
- **GitLab mirror**: Requires both `GITHUB_TOKEN` (for GitHub) and
  `GITLAB_TOKEN` (for GitLab)

### SSH vs HTTPS

Code backup scripts support both SSH and HTTPS for GitHub operations:

- Set `USE_GITHUB_SSH="true"` to use SSH (requires SSH keys configured)
- Default is HTTPS with token authentication

### GitLab Project Creation

The GitLab mirror script can automatically create GitLab projects if they don't
exist:

- Set `AUTO_CREATE_GITLAB_PROJECTS="true"` (default)
- New projects will be created with visibility set by `GITLAB_VISIBILITY`
  (default: `private`)

### Submodules

For repositories with submodules, ensure they're properly initialized:

```bash
git submodule update --init --recursive
```

---

## Related

- [System Scripts](https://github.com/garretpatten/system-scripts) — the incubator
  repository this project graduated from; it consumes `backup-manager` as a submodule
- [GitHub API Documentation](https://docs.github.com/en/rest)
- [GitLab API Documentation](https://docs.gitlab.com/ee/api/)
- [Notion API Documentation](https://developers.notion.com/)
- [Google Calendar API Documentation](https://developers.google.com/calendar/api/v3/reference)
- [Google Tasks API Documentation](https://developers.google.com/tasks/reference/rest)
- [Google People API Documentation](https://developers.google.com/people/api/rest)
- [Spotify Web API Documentation](https://developer.spotify.com/documentation/web-api)
- [Todoist API Documentation](https://developer.todoist.com/api/v1)
- [Git Personal Access Tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token)
- [GitLab Personal Access Tokens](https://docs.gitlab.com/ee/user/profile/personal_access_tokens.html)

## Security

Security vulnerabilities are not tracked in public issues; see
[SECURITY.md](./SECURITY.md) for the disclosure process.

## License

MIT — see [LICENSE](./LICENSE).
