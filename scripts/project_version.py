"""Read the only handwritten project version.

This repository is a Node.js action. The version field of package.json is
the canonical copy, as defined by
https://docs.npmjs.com/cli/v10/configuring-npm/package-json#version
"""

from __future__ import annotations

import json
from pathlib import Path


def read_version(manifest: Path) -> str:
    """Return the package.json version string.

    The accepted form is a numeric ``MAJOR.MINOR.PATCH`` core. Semver
    numeric identifiers have no leading zeroes
    (https://semver.org/spec/v2.0.0.html). This repository's tags use
    that core with a leading ``v`` and no pre-release suffix.
    """
    data = json.loads(manifest.read_text(encoding="utf-8"))
    version = data["version"]
    if not isinstance(version, str):
        raise ValueError("package.json version must be a string")
    parts = version.split(".")
    if len(parts) != 3 or any(not _numeric_component(part) for part in parts):
        raise ValueError(
            "package.json version must be MAJOR.MINOR.PATCH with numeric "
            f"semver components, got {version!r}"
        )
    return version


def _numeric_component(part: str) -> bool:
    """True for ``0`` or a decimal integer that does not start with ``0``.

    A leading zero would be padding, which semver forbids for numeric
    identifiers. The single character ``0`` is the only allowed zero.
    """
    if not part.isdigit():
        return False
    if part.startswith("0") and part != "0":
        return False
    return True


def short_version(version: str) -> str:
    """Return the Sphinx ``version`` (major.minor) for a full release.

    Sphinx defines ``version`` as the short X.Y form and ``release`` as
    the full version string:
    https://www.sphinx-doc.org/en/master/usage/configuration.html#confval-version
    Semver orders the components major, minor, patch, so the short form
    is the first two.
    """
    full = read_version_string(version)
    major, minor, _patch = full.split(".")
    return f"{major}.{minor}"


def read_version_string(version: str) -> str:
    """Validate a version string that was already read from package.json."""
    parts = version.split(".")
    if len(parts) != 3 or any(not _numeric_component(part) for part in parts):
        raise ValueError(
            "version must be MAJOR.MINOR.PATCH with numeric semver "
            f"components, got {version!r}"
        )
    return version


def major_version(version: str) -> str:
    """Return the major component.

    Workflow examples pin the moving major tag, the letter v and this
    number after the at sign. That number is the first semver component
    (https://semver.org/spec/v2.0.0.html).
    """
    major, _minor, _patch = read_version_string(version).split(".")
    return major


def readme_badge(version: str) -> str:
    """Markdown shields badge for the readme header.

    The host matches the License badge already in that header
    (``img.shields.io``). The color token ``blue`` matches the GitHub
    badge on the following line of the same header.
    """
    full = read_version_string(version)
    return (
        "[![Version](https://img.shields.io/badge/version-"
        + full
        + "-blue)](https://github.com/HaoZeke/asv-perch/releases/tag/v"
        + full
        + ")"
    )


def changelog_link(version: str) -> str:
    """reStructuredText link to the git tag for this release."""
    full = read_version_string(version)
    return (
        "Current release: `"
        + full
        + " <https://github.com/HaoZeke/asv-perch/releases/tag/v"
        + full
        + ">`_."
    )


def changelog_cog_output(version: str) -> str:
    """Cog output for the changelog link.

    Docutils requires a blank line between explicit markup and a
    paragraph. The generated link is therefore wrapped in blank lines
    so the cog markers can stay in reStructuredText comments.
    https://docutils.sourceforge.io/docs/ref/rst/restructuredtext.html#comments
    """
    return "\n" + changelog_link(version) + "\n\n"
