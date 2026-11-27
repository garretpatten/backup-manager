#!/usr/bin/env bash
# Thin wrapper around the TypeScript Google Calendar backup implementation.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
MODULE_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)

cd "$MODULE_ROOT"
npx tsx src/google-calendar-backup.ts
