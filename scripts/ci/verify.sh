#!/usr/bin/env bash
# Swear Jar CI gate — green before every commit/publish.
# It's a zero-dependency, local-only tool, so the gate is lean:
# syntax check + unit tests + a demo smoke that must render a real report.
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "==> python syntax"
python3 -c "import ast,glob; [ast.parse(open(f).read(),f) for f in ['swearjar.py','test_swearjar.py',*glob.glob('swearjar/*.py')]]"

echo "==> import the package"
python3 -c "import swearjar; print('  swearjar', swearjar.__version__)"

echo "==> unit tests"
python3 -m unittest -q test_swearjar

echo "==> demo smoke (in-memory, no Superwhisper folder needed)"
tmp="$(mktemp -t swearjar.XXXXXX).html"
python3 swearjar.py --demo --out "$tmp" >/dev/null
grep -q "Swear Jar" "$tmp" || { echo "FAIL: report missing content"; exit 1; }
if grep -q "/\*__DATA__\*/" "$tmp"; then echo "FAIL: data placeholder not replaced"; exit 1; fi
rm -f "$tmp"

echo "✅ verify.sh green"
