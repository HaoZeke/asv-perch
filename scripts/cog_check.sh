#!/bin/sh
# Install cog and fail if generated version text drifted.
# cog --check: https://cog.readthedocs.io/en/latest/running.html
# The version-consistency test is scripts/check_version_sot.py.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT"
. "$ROOT/scripts/version_venv.sh"
echo "cog --check"
"$VENV/bin/python" -m cogapp --check \
  --check-fail-msg "Regenerate with: .venv-version/bin/python -m cogapp -r readme_src.org README.md docs/source/changelog.rst" \
  readme_src.org README.md docs/source/changelog.rst
echo "version-consistency"
"$VENV/bin/python" "$ROOT/scripts/check_version_sot.py"
echo "version-consistency tests"
"$VENV/bin/python" -m unittest discover -s "$ROOT/scripts" -p 'test_*.py'
