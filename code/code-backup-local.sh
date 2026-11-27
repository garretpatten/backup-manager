#!/usr/bin/env bash
# Thin wrapper around the TypeScript local code backup implementation.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
MODULE_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)

cd "$MODULE_ROOT"
npx tsx src/local-backup.ts
