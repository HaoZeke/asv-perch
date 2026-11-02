#!/usr/bin/env python3
"""Fail when a project version copy does not match package.json.

The handwritten copy is the ``version`` field of package.json. Generated
copies are the cog output in the readme sources and the changelog. Sphinx
reads the field at docs build time, so conf.py must not assign a literal.
Towncrier must not store a second copy; scripts/towncrier_build.sh passes
``--version`` (https://towncrier.readthedocs.io/en/stable/tutorial.html#detecting-version).
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

from project_version import (
    changelog_cog_output,
    major_version,
    read_version,
    readme_badge,
)

# scripts/check_version_sot.py lives one directory below the repository root.
ROOT = Path(__file__).resolve().parents[1]

# Lockfiles pin third-party packages. A dependency can share this
# project's version number without being a copy of it (yocto-queue did
# so in bun.lock at the time the manifest version was first recorded).
SKIP_DIR_NAMES = {
    ".git",
    ".pixi",
    ".venv-version",
    "dist",
    "node_modules",
    "__pycache__",
}
SKIP_FILE_NAMES = {
    "bun.lock",
    "pixi.lock",
}
TEXT_SUFFIXES = {
    ".el",
    ".html",
    ".js",
    ".json",
    ".md",
    ".org",
    ".py",
    ".rst",
    ".sh",
    ".toml",
    ".ts",
    ".txt",
    ".yaml",
    ".yml",
}

PIN_RE = re.compile(r"asv-perch@v(\d+(?:\.\d+\.\d+)?)")
PROSE_PIN_RES = (
    re.compile(r"=@v(\d+)="),
    re.compile(r"=~v(\d+)="),
    re.compile(r"`@v(\d+)`"),
)
COG_FILES = (
    "readme_src.org",
    "README.md",
    "docs/source/changelog.rst",
)


class Drift(Exception):
    pass


def main() -> int:
    errors: list[str] = []
    try:
        version = read_version(ROOT / "package.json")
    except (OSError, ValueError, KeyError) as exc:
        print(f"version-sot: {exc}", file=sys.stderr)
        return 1

    manifest = (ROOT / "package.json").read_text(encoding="utf-8")
    field = f'"version": "{version}"'
    if manifest.count(field) != 1:
        errors.append(
            "package.json must contain the version field exactly once"
        )

    errors.extend(_check_cog(version))
    errors.extend(_check_conf())
    errors.extend(_check_towncrier(version))
    errors.extend(_check_pins(version))
    errors.extend(_check_literal_copies(version))

    if errors:
        for item in errors:
            print(f"version-sot: {item}", file=sys.stderr)
        return 1
    print(f"version-sot: ok {version}")
    return 0


def _check_cog(version: str) -> list[str]:
    errors: list[str] = []
    expected = {
        "readme_src.org": readme_badge(version) + "\n",
        "README.md": readme_badge(version) + "\n",
        "docs/source/changelog.rst": changelog_cog_output(version),
    }
    for rel in COG_FILES:
        path = ROOT / rel
        if not path.is_file():
            errors.append(f"{rel} is missing")
            continue
        text = path.read_text(encoding="utf-8")
        if text.count("[[[cog") != 1:
            errors.append(f"{rel} must contain one cog block")
            continue
        try:
            output = _cog_output(text)
        except Drift as exc:
            errors.append(f"{rel}: {exc}")
            continue
        if output != expected[rel]:
            errors.append(
                f"{rel} cog output does not match package.json\n"
                f"  expected: {expected[rel]!r}\n"
                f"  found:    {output!r}"
            )
    return errors


def _cog_output(text: str) -> str:
    cog_at = text.find("[[[cog")
    if cog_at < 0:
        raise Drift("missing cog start marker")
    close = text.find("]]]", cog_at + len("[[[cog"))
    if close < 0:
        raise Drift("missing cog code end marker")
    line_end = text.find("\n", close)
    if line_end < 0:
        raise Drift("cog code end marker is not on its own line")
    end_at = text.find("[[[end]]]", line_end)
    if end_at < 0:
        raise Drift("missing cog end marker")
    end_line = text.rfind("\n", line_end, end_at)
    if end_line < line_end:
        raise Drift("cog end marker is not on its own line")
    return text[line_end + 1:end_line + 1]


def _check_conf() -> list[str]:
    text = (ROOT / "docs/source/conf.py").read_text(encoding="utf-8")
    if re.search(r"(?m)^\s*(version|release)\s*=\s*['\"]", text):
        return ["docs/source/conf.py assigns a literal version or release"]
    if "read_version(" not in text or "short_version(" not in text:
        return [
            "docs/source/conf.py must read package.json via "
            "scripts/project_version.py"
        ]
    return []


def _check_towncrier(version: str) -> list[str]:
    errors: list[str] = []
    config = (ROOT / "towncrier.toml").read_text(encoding="utf-8")
    if re.search(r"(?m)^version\s*=", config):
        errors.append("towncrier.toml must not set version")
    if version in config:
        errors.append("towncrier.toml must not contain the project version")
    script = (ROOT / "scripts/towncrier_build.sh").read_text(encoding="utf-8")
    if "--version" not in script or "package.json" not in script:
        errors.append(
            "scripts/towncrier_build.sh must pass package.json to --version"
        )
    return errors


def _check_pins(version: str) -> list[str]:
    """Workflow pins are the major tag or the full release tag.

    github_actions.org documents both forms. Any other number is drift.
    """
    errors: list[str] = []
    major = major_version(version)
    found = 0
    for path in _text_files():
        rel = path.relative_to(ROOT).as_posix()
        lines = path.read_text(encoding="utf-8").splitlines()
        for number, line in enumerate(lines, start=1):
            for pin in PIN_RE.findall(line):
                found += 1
                if not _pin_ok(pin, major, version):
                    errors.append(
                        f"{rel}:{number} pins v{pin}, canonical is {version}"
                    )
            for pattern in PROSE_PIN_RES:
                for pin in pattern.findall(line):
                    found += 1
                    if pin != major:
                        errors.append(
                            f"{rel}:{number} mentions @v{pin}, "
                            f"major is {major}"
                        )
    if found == 0:
        errors.append("no asv-perch version pins found")
    return errors


def _pin_ok(pin: str, major: str, version: str) -> bool:
    if pin == major:
        return True
    if pin == version:
        return True
    return False


def _check_literal_copies(version: str) -> list[str]:
    """The full version string may appear only in the canonical field and cog output."""
    errors: list[str] = []
    allowed = {
        "package.json": 1,
        "readme_src.org": 2,
        "README.md": 2,
        "docs/source/changelog.rst": 2,
    }
    # The badge and the changelog link each mention the version twice:
    # once in the visible text and once in the release-tag URL.
    seen: dict[str, int] = {}
    for path in _text_files():
        rel = path.relative_to(ROOT).as_posix()
        count = path.read_text(encoding="utf-8").count(version)
        if count == 0:
            continue
        seen[rel] = count
        if rel not in allowed:
            errors.append(
                f"{rel} contains the project version {count} time(s) "
                "outside the canonical field and cog output"
            )
        elif count != allowed[rel]:
            errors.append(
                f"{rel} contains the project version {count} time(s), "
                f"expected {allowed[rel]}"
            )
    for rel, expected in allowed.items():
        if seen.get(rel) != expected:
            if rel not in seen:
                errors.append(f"{rel} does not contain the project version")
    return errors


def _text_files() -> list[Path]:
    found: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        # docs/build is Sphinx output, not a source copy of the version.
        dirnames[:] = [
            name for name in dirnames
            if name not in SKIP_DIR_NAMES
            and not (Path(dirpath) == ROOT / "docs" and name == "build")
        ]
        for name in filenames:
            path = Path(dirpath) / name
            if path.name in SKIP_FILE_NAMES:
                continue
            if path.suffix not in TEXT_SUFFIXES and path.name not in {
                "action.yml",
            }:
                continue
            found.append(path)
    return found


if __name__ == "__main__":
    sys.exit(main())
