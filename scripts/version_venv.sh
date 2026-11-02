# Sourced by scripts/cog_check.sh and scripts/towncrier_build.sh after
# they set the repository root. It creates the virtualenv at
# .venv-version with the pins in scripts/requirements-version-sot.txt.
# check_version_sot.py reads towncrier.toml with tomllib, which joined
# the standard library in Python 3.11
# (https://docs.python.org/3/library/tomllib.html).
if ! python3 -c 'import sys; sys.exit(sys.version_info < (3, 11))'; then
  echo "version-venv: Python 3.11 or newer is required, found $(python3 -V 2>&1)" >&2
  exit 1
fi
VENV="$ROOT/.venv-version"
REQUIREMENTS="$ROOT/scripts/requirements-version-sot.txt"
# The marker stores the hash of the requirements file. It is written only
# after pip succeeds, so a missing or stale marker means an interrupted
# install or changed pins. A python, towncrier or cog that does not run
# also means a broken install. Any of these rebuilds the virtualenv.
MARKER="$VENV/.requirements.sha256"
WANT=$(python3 -c 'import hashlib, sys
print(hashlib.sha256(open(sys.argv[1], "rb").read()).hexdigest())' "$REQUIREMENTS")
if [ ! -x "$VENV/bin/python" ] \
  || ! "$VENV/bin/towncrier" --version >/dev/null 2>&1 \
  || ! "$VENV/bin/python" -c 'import cogapp' >/dev/null 2>&1 \
  || [ "$(cat "$MARKER" 2>/dev/null)" != "$WANT" ]; then
  echo "version-venv: building $VENV" >&2
  rm -rf "$VENV"
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install --disable-pip-version-check -r "$REQUIREMENTS" >&2
  printf '%s\n' "$WANT" > "$MARKER"
fi
