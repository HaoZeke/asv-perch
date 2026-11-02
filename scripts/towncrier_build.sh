#!/bin/sh
# Pass the package.json version to towncrier so the config stores none.
# https://towncrier.readthedocs.io/en/stable/tutorial.html#detecting-version
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
VERSION=$(
  python3 -c 'import sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
from project_version import read_version
print(read_version(Path(sys.argv[2])))
' "$ROOT/scripts" "$ROOT/package.json"
)
cd "$ROOT"
exec towncrier build --version "$VERSION" "$@"
