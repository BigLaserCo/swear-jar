#!/usr/bin/env bash
# scripts/ci/verify.sh — thin shell entry point for the canonical gate.
# The real gate is scripts/ci/verify.mjs (gates (a)-(h)); this wrapper exists
# so any tooling that expects a shell entry point runs the same gate.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
exec node scripts/ci/verify.mjs "$@"
