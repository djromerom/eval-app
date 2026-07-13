#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
set -o allexport
. .env
set +o allexport
pnpm tsx scripts/verify-omr.ts
