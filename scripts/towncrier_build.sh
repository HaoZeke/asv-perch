#!/bin/sh
# Pass the package.json version to towncrier so the config stores none.
# https://towncrier.readthedocs.io/en/stable/tutorial.html#detecting-version
# towncrier runs from the pinned virtualenv that scripts/cog_check.sh uses,
# so the build does not depend on a towncrier found on PATH.
set -eu
# towncrier keeps the last --version it is given, so a caller's own
# --version would replace the package.json one. Exit status 2 matches
# the status towncrier gives for its own usage errors.
for arg in "$@"; do
  case $arg in
    --version | --version=*)
      echo "towncrier_build: the version comes from package.json, drop $arg" >&2
      exit 2
      ;;
  esac
done
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
. "$ROOT/scripts/version_venv.sh"
VERSION=$(
  "$VENV/bin/python" -c 'import sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
from project_version import read_version
print(read_version(Path(sys.argv[2])))
' "$ROOT/scripts" "$ROOT/package.json"
)
cd "$ROOT"
exec "$VENV/bin/towncrier" build --version "$VERSION" "$@"
