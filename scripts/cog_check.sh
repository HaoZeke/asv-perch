#!/bin/sh
# Install cog and fail if generated version text drifted.
# cog --check: https://cog.readthedocs.io/en/latest/running.html
# The version-consistency test is scripts/check_version_sot.py.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT"
VENV="$ROOT/.venv-version"
if [ ! -x "$VENV/bin/python" ]; then
  python3 -m venv "$VENV"
fi
if ! "$VENV/bin/python" -c 'import cogapp' >/dev/null 2>&1; then
  "$VENV/bin/pip" install --disable-pip-version-check -r "$ROOT/scripts/requirements-version-sot.txt"
fi
echo "cog --check"
"$VENV/bin/python" -m cogapp --check \
  --check-fail-msg "Regenerate with: python3 -m cogapp -r readme_src.org README.md docs/source/changelog.rst" \
  readme_src.org README.md docs/source/changelog.rst
echo "version-consistency"
"$VENV/bin/python" "$ROOT/scripts/check_version_sot.py"
