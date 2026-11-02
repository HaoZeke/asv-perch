#!/usr/bin/env python3
"""Fail when a project version copy does not match package.json.

The handwritten copy is the ``version`` field of package.json. Generated
copies are the cog output in the readme sources and the changelog. Sphinx
reads the field at docs build time, so conf.py must not assign a literal.
Towncrier must not store a second copy; scripts/towncrier_build.sh passes
``--version`` (https://towncrier.readthedocs.io/en/stable/tutorial.html#detecting-version).
"""

from __future__ import annotations

import sys

# tomllib joined the standard library in Python 3.11
# (https://docs.python.org/3/library/tomllib.html).
if sys.version_info < (3, 11):
    sys.exit(
        "version-sot: Python 3.11 or newer is required for tomllib, "
        f"found {sys.version.split()[0]}"
    )

import ast
import fnmatch
import json
import re
import subprocess
import tomllib
from pathlib import Path

from project_version import (
    changelog_cog_output,
    major_version,
    read_version,
    read_version_string,
    readme_badge,
)

# scripts/check_version_sot.py lives one directory below the repository root.
ROOT = Path(__file__).resolve().parents[1]

# The copy scan looks for this project's version, so it reads only text
# that can refer to this project. Text that records or pins other
# software can hold the same X.Y.Z without meaning this project, and a
# later release that happened to equal it would fail.
# Docs, notes and sources stay in the scan, bare versions included.
#
# The scan reads the files in the git index, so untracked local trees
# such as a virtualenv stay out of it.
# dist is the bundled action, which inlines third-party packages.
# Sphinx writes its output to docs/build.
# test/fixtures holds recorded asv results and compare output from a
# benchmark machine, so its numbers describe that machine and its
# packages.
SKIP_DIRS = (
    "dist",
    "docs/build",
    "test/fixtures",
)
# These file kinds pin other software and never this project.
# Lockfiles pin third-party packages (yocto-queue shared this project's
# version in bun.lock when the manifest version was first recorded).
# A pip requirements file pins Python packages
# (https://pip.pypa.io/en/stable/reference/requirements-file-format/).
# The pre-commit config pins each hook repository with rev
# (https://pre-commit.com/#pre-commit-configyaml---repos).
TOOL_PIN_FILES = (
    "bun.lock",
    "pixi.lock",
    "requirements*.txt",
    ".pre-commit-config.yaml",
)
# A workflow step names another action as owner/repo, an optional path,
# and a git ref after the at sign
# (https://docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions#jobsjob_idstepsuses).
# The ref is that action's version. This project's own refs are left to
# _check_pins.
ACTION_REF_RE = re.compile(
    r"(?<![\w.-])(?P<slug>[\w.-]+/[\w.-]+)(?:/[\w./-]+)?@[\w.+-]+"
)
# SVG geometry attributes hold coordinates, and path data writes them
# with no separator before a leading dot, so two numbers can read as
# one dotted version
# (https://www.w3.org/TR/SVG2/paths.html#PathDataBNF).
SVG_GEOMETRY_RE = re.compile(r'\b(?:d|points|transform|viewBox)="[^"]*"')

# A pin captures the whole git ref after the at sign, so the refs v1.2
# and v1.99 are read whole and fail, rather than as major 1.
# A trailing full stop is sentence punctuation, not part of a semver tag
# (https://semver.org/spec/v2.0.0.html#backusnaur-form-grammar-for-valid-semver-versions).
PIN_RE = re.compile(r"asv-perch@v([0-9][0-9A-Za-z.+-]*)")
PROSE_PIN_RES = (
    # The bracketed delimiters keep these lines from matching themselves.
    re.compile(r"[=]@v([^=\s]+)[=]"),
    re.compile(r"[=]~v([^=\s]+)[=]"),
    re.compile(r"[`]@v([^`\s]+)[`]"),
)
# A link to another site can carry the same number in its path, as the
# semver spec does at https://semver.org/spec/v2.0.0.html. Links into this
# project can carry the release tag, so they stay in the count.
# The project's own sites are the package.json homepage and repository
# and the html_baseurl of the docs (_project_url_prefixes).
# The class lists the URI characters from section 2 of the URI standard
# (https://www.rfc-editor.org/rfc/rfc3986#section-2), less the
# parentheses that close a link in running text.
URI_CHARS = r"[A-Za-z0-9\-._~:/?#\[\]@!$&'*+,;=%]+"
# Sphinx reads html_baseurl as the site's base URL
# (https://www.sphinx-doc.org/en/master/usage/configuration.html#confval-html_baseurl).
DOCS_CONF = "docs/source/conf.py"
# npm lists other packages' versions under these keys
# (https://docs.npmjs.com/cli/v10/configuring-npm/package-json#dependencies).
# They are not copies of this project's version.
NPM_DEPENDENCY_KEYS = (
    "bundleDependencies",
    "bundledDependencies",
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "overrides",
    "peerDependencies",
)
COG_FILES = (
    "readme_src.org",
    "README.md",
    "docs/source/changelog.rst",
)


# towncrier writes each release below this line and keeps the text above it.
# https://towncrier.readthedocs.io/en/stable/configuration.html
TOWNCRIER_DEFAULT_START = ".. towncrier release notes start"
# The bundled templates render this title when title_format is empty.
# https://towncrier.readthedocs.io/en/stable/configuration.html
TOWNCRIER_DEFAULT_TITLE = "{name} {version} ({project_date})"


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

    sources = _source_texts()
    errors.extend(_check_cog(version))
    errors.extend(_check_conf())
    errors.extend(_check_towncrier(version))
    errors.extend(_check_release_headings(version))
    errors.extend(_check_pins(version, sources))
    errors.extend(_check_literal_copies(version, sources))

    if errors:
        for item in errors:
            print(f"version-sot: {item}", file=sys.stderr)
        return 1
    print(f"version-sot: ok {version}")
    return 0


def _cog_outputs(version: str) -> dict[str, str]:
    """Return the text cog must write in each file, from the generators."""
    return {
        "readme_src.org": readme_badge(version) + "\n",
        "README.md": readme_badge(version) + "\n",
        "docs/source/changelog.rst": changelog_cog_output(version),
    }


def _check_cog(version: str) -> list[str]:
    errors: list[str] = []
    expected = _cog_outputs(version)
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
    if _version_token(version).search(config):
        errors.append("towncrier.toml must not contain the project version")
    script = (ROOT / "scripts/towncrier_build.sh").read_text(encoding="utf-8")
    if "--version" not in script or "package.json" not in script:
        errors.append(
            "scripts/towncrier_build.sh must pass package.json to --version"
        )
    return errors


def _check_pins(version: str, sources: dict[str, str]) -> list[str]:
    """Workflow pins are the major tag or the full release tag.

    github_actions.org documents both forms. Any other number is drift.
    Published release notes keep the pins they were written with.
    """
    errors: list[str] = []
    major = major_version(version)
    found = 0
    for rel, text in sources.items():
        lines = text.splitlines()
        for number, line in enumerate(lines, start=1):
            for pin in PIN_RE.findall(line):
                pin = pin.rstrip(".")
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


def _version_token(version: str) -> re.Pattern[str]:
    """Match the version as a whole token, not inside another version.

    A digit or dot on either side means a longer number: an extra leading
    digit, an extra trailing digit or a fourth component.
    A two-character comparison operator before it means a version
    specifier for another package, such as a docs example that pins a
    dependency (Python Enhancement Proposal 440,
    https://peps.python.org/pep-0440/#version-specifiers).
    A single ``=`` or ``~`` is not skipped, since org markup wraps verbatim
    and code text in them.
    npm ranges such as ``^`` and ``~`` sit in the package.json dependency
    tables, which _manifest_text removes before the scan.
    The examples name no version, since this file is scanned too.
    A full workflow pin is left to _check_pins, which already requires it
    to equal the current version.
    """
    return re.compile(
        r"(?<![0-9.])(?<!==)(?<!~=)(?<!>=)(?<!<=)(?<!!=)(?<!asv-perch@v)"
        + re.escape(version)
        + r"(?![0-9]|\.[0-9])"
    )


def _project_url_prefixes(root: Path) -> list[str]:
    """Return the project's own URL prefixes, without the scheme.

    They come from the package.json ``homepage`` and ``repository``
    fields (https://docs.npmjs.com/cli/v10/configuring-npm/package-json#homepage)
    and from ``html_baseurl`` in the docs configuration.
    """
    data = json.loads((root / "package.json").read_text(encoding="utf-8"))
    urls = [data.get("homepage")]
    repository = data.get("repository")
    urls.append(
        repository.get("url") if isinstance(repository, dict) else repository
    )
    conf = root / DOCS_CONF
    if conf.is_file():
        tree = ast.parse(conf.read_text(encoding="utf-8"))
        for node in tree.body:
            if (
                isinstance(node, ast.Assign)
                and any(
                    isinstance(target, ast.Name)
                    and target.id == "html_baseurl"
                    for target in node.targets
                )
                and isinstance(node.value, ast.Constant)
                and isinstance(node.value.value, str)
            ):
                urls.append(node.value.value)
    prefixes: list[str] = []
    for url in urls:
        if not isinstance(url, str):
            continue
        # npm accepts git+https and a trailing .git in repository.url.
        match = re.match(r"(?:git\+)?https?://([^#?]+?)(?:\.git)?/*$", url)
        if match is not None and match.group(1) not in prefixes:
            prefixes.append(match.group(1))
    return prefixes


def _own_slugs(root: Path) -> set[str]:
    """Return owner/repo for each project URL with an owner and a repo."""
    slugs: set[str] = set()
    for prefix in _project_url_prefixes(root):
        parts = prefix.split("/")
        if len(parts) == 3:
            slugs.add(f"{parts[1]}/{parts[2]}".lower())
    return slugs


def scan_text(text: str, root: Path = ROOT) -> str:
    """Return the text the copy scan counts in.

    Links to other sites, refs of other actions and SVG geometry are
    blanked, since their numbers belong to other software or to drawing
    coordinates.
    """
    own = _own_slugs(root)
    text = foreign_url_re(root).sub(" ", text)
    text = ACTION_REF_RE.sub(
        lambda m: m.group(0) if m.group("slug").lower() in own else " ", text
    )
    return SVG_GEOMETRY_RE.sub(" ", text)


def foreign_url_re(root: Path = ROOT) -> re.Pattern[str]:
    """Match a link to a site other than the project's own sites."""
    own = "|".join(re.escape(prefix) for prefix in _project_url_prefixes(root))
    # A prefix ends at a path, query or fragment, so a longer host name
    # that starts with the same text is still foreign.
    guard = rf"(?!(?:{own})(?![\w.-]))" if own else ""
    return re.compile(r"https?://" + guard + URI_CHARS)


def _manifest_text(text: str) -> str:
    """Return package.json without the tables that hold dependency versions."""
    data = json.loads(text)
    for key in NPM_DEPENDENCY_KEYS:
        data.pop(key, None)
    return json.dumps(data)


def _check_literal_copies(
    version: str, sources: dict[str, str]
) -> list[str]:
    """The full version string may appear only in the canonical field and cog output."""
    errors: list[str] = []
    token = _version_token(version)

    def copies(text: str) -> int:
        return len(token.findall(scan_text(text)))

    # Each allowed file may hold as many copies as its generated text does.
    allowed = {
        "package.json": copies(f'"version": "{version}"'),
    }
    for rel, output in _cog_outputs(version).items():
        allowed[rel] = copies(output)
    seen: dict[str, int] = {}
    for rel, text in sources.items():
        if rel == "package.json":
            text = _manifest_text(text)
        count = copies(text)
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


def _check_release_headings(version: str) -> list[str]:
    """Each release may have one heading, below the marker, in the notes file.

    towncrier refuses a second build only when the rendered title_format
    line is already present, and that line includes the build date
    (https://towncrier.readthedocs.io/en/stable/configuration.html).
    A rebuild on another day would add a second heading, so the check
    reads every heading below the marker and compares versions.

    towncrier writes each release below the marker, so a heading above it
    was written by hand.
    scripts/towncrier_build.sh passes the package.json version, so each
    built heading names a version that package.json held at build time.
    The release tags of this repository were created in semver order, as
    ``git for-each-ref --sort=creatordate refs/tags`` lists them, so
    package.json only moves forward.
    A heading may therefore name the current version or an earlier one.
    A later version, or one without three numeric parts, never came from
    package.json.
    Semver orders numeric cores by comparing their components as integers
    (https://semver.org/spec/v2.0.0.html#spec-item-11).
    """
    config = _towncrier_config()
    notes_file, notes_start = _towncrier_notes()
    title_format = config.get("title_format") or TOWNCRIER_DEFAULT_TITLE
    heading = re.compile(
        re.escape(title_format)
        .replace(re.escape("{name}"), re.escape(config.get("name", "")))
        .replace(re.escape("{version}"), r"(?P<version>\S+)")
        .replace(re.escape("{project_date}"), r".+")
    )
    text = (ROOT / notes_file).read_text(encoding="utf-8")
    if notes_start not in text:
        return [f"{notes_file} is missing the towncrier start marker"]
    head, body = text.split(notes_start, 1)
    errors: list[str] = []
    for number, line in enumerate(head.splitlines(), start=1):
        if heading.fullmatch(line.strip()) is not None:
            errors.append(
                f"{notes_file}:{number} has a release heading above the "
                "towncrier marker"
            )
    current = _release_key(version)
    seen: dict[str, int] = {}
    for number, line in enumerate(body.splitlines(), start=1):
        match = heading.fullmatch(line.strip())
        if match is None:
            continue
        release = match.group("version")
        key = _release_key(release)
        if key is None:
            errors.append(
                f"{notes_file} has a release heading for {release}, which is "
                f"not MAJOR.MINOR.PATCH (line {number} below the marker)"
            )
        elif key > current:
            errors.append(
                f"{notes_file} has a release heading for {release}, later "
                f"than package.json {version} (line {number} below the marker)"
            )
        if release in seen:
            errors.append(
                f"{notes_file} has a second release heading for {release} "
                f"(lines {seen[release]} and {number} below the marker)"
            )
        else:
            seen[release] = number
    return errors


def _release_key(version: str) -> tuple[int, ...] | None:
    """Return the semver order key of a numeric core, or None for another form."""
    try:
        core = read_version_string(version)
    except ValueError:
        return None
    return tuple(int(part) for part in core.split("."))


def _towncrier_config() -> dict:
    return tomllib.loads(
        (ROOT / "towncrier.toml").read_text(encoding="utf-8")
    )["tool"]["towncrier"]


def _towncrier_notes() -> tuple[str, str]:
    """Return the release-notes file and the line towncrier writes below."""
    config = _towncrier_config()
    return (
        config["filename"],
        config.get("start_string", TOWNCRIER_DEFAULT_START).rstrip("\n"),
    )


def _source_texts() -> dict[str, str]:
    """Return the scanned text of each source file, keyed by path.

    Release sections below the towncrier marker are published notes.
    They keep the versions and pins of their own release, so both the
    copy scan and the pin scan read only the text above the marker.
    """
    notes_file, notes_start = _towncrier_notes()
    texts: dict[str, str] = {}
    for rel in _text_files():
        text = _read_text(ROOT / rel)
        if text is None:
            continue
        if rel == notes_file:
            text = text.split(notes_start, 1)[0]
        texts[rel] = text
    return texts


def _read_text(path: Path) -> str | None:
    """Return the file as UTF-8 text, or None when it is not text.

    Text sources are UTF-8. Images and other binaries contain a zero byte
    or bytes that do not decode as UTF-8, and the scan skips them.
    """
    data = path.read_bytes()
    if b"\0" in data:
        return None
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return None


def _text_files() -> list[str]:
    """Return the files in the git index (https://git-scm.com/docs/git-ls-files)."""
    result = subprocess.run(
        ["git", "ls-files", "-z", "--cached"],
        cwd=ROOT,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        sys.exit(
            "version-sot: git ls-files failed; run the check in a git "
            "checkout\n" + result.stderr.decode("utf-8", "replace")
        )
    found: list[str] = []
    for raw in sorted(set(result.stdout.split(b"\0"))):
        if not raw:
            continue
        rel = raw.decode("utf-8")
        if any(rel.startswith(skip + "/") for skip in SKIP_DIRS):
            continue
        name = Path(rel).name
        if any(fnmatch.fnmatchcase(name, pat) for pat in TOOL_PIN_FILES):
            continue
        if not (ROOT / rel).is_file():
            # A tracked file deleted in the work tree has nothing to scan.
            continue
        found.append(rel)
    return found


if __name__ == "__main__":
    sys.exit(main())
