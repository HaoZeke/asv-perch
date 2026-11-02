#!/bin/sh
# Pass the package.json version to towncrier so the config stores none.
# https://towncrier.readthedocs.io/en/stable/tutorial.html#detecting-version
# towncrier runs from the pinned virtualenv that scripts/cog_check.sh uses,
# so the build does not depend on a towncrier found on PATH.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
VENV="$ROOT/.venv-version"
if [ ! -x "$VENV/bin/python" ]; then
  python3 -m venv "$VENV"
fi
if [ ! -x "$VENV/bin/towncrier" ]; then
  "$VENV/bin/pip" install --disable-pip-version-check -r "$ROOT/scripts/requirements-version-sot.txt"
fi
if [ ! -x "$VENV/bin/towncrier" ]; then
  echo "towncrier_build: $VENV/bin/towncrier is missing after install" >&2
  exit 1
fi
VERSION=$(
  python3 -c 'import sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
from project_version import read_version
print(read_version(Path(sys.argv[2])))
' "$ROOT/scripts" "$ROOT/package.json"
)
cd "$ROOT"
exec "$VENV/bin/towncrier" build --version "$VERSION" "$@"
