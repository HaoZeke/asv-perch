"""Regression tests for scripts/check_version_sot.py.

Each test copies the checkout into a temporary git repository, edits the
copy and runs the check there. Versions and pins are built from
package.json at run time, so this file contains no copy of the version.
"""

from __future__ import annotations

import ast
import json
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from project_version import (  # noqa: E402
    changelog_cog_output,
    major_version,
    read_version,
    readme_badge,
)
from check_version_sot import (  # noqa: E402
    DOCS_CONF,
    _project_url_prefixes,
    _towncrier_config,
    _towncrier_notes,
    scan_text,
)

# Built in pieces so the check does not read these lines as pins.
PIN = "asv-perch" + "@v"
PROSE_PIN = "=" + "@v"
# Every pin form the check reads, as the text before the major number.
LIVE_PIN_PREFIXES = (PIN, PROSE_PIN, "=" + "~v", "`" + "@v")
NOTES, MARKER = _towncrier_notes()
DOC = "docs/orgmode/tutorials/cross_environment.org"


def _release_title(version: str) -> str:
    """Render the release heading as a towncrier build does.

    towncrier fills project_date with the build day when no --date is
    given (https://towncrier.readthedocs.io/en/stable/cli.html).
    The check reads only the version from the heading, so any day works.
    """
    config = _towncrier_config()
    return config["title_format"].format(
        name=config["name"],
        version=version,
        project_date=date.today().isoformat(),
    )


def _cog_outputs(version: str) -> dict[str, str]:
    return {
        "readme_src.org": readme_badge(version) + "\n",
        "README.md": readme_badge(version) + "\n",
        NOTES: changelog_cog_output(version),
    }


class Checkout:
    """A scratch copy of the files git lists for the checkout."""

    def __init__(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        self.root = Path(self._dir.name)
        listed = subprocess.run(
            ["git", "ls-files", "-z", "--cached"],
            cwd=ROOT, capture_output=True, check=True,
        ).stdout.split(b"\0")
        for raw in listed:
            if not raw:
                continue
            src = ROOT / raw.decode("utf-8")
            if not src.is_file():
                continue
            dest = self.root / raw.decode("utf-8")
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dest)
        # Keep the notes above the marker only. Release sections that a
        # real towncrier build added would otherwise collide with the
        # sections the tests publish for the same version.
        notes = self.root / NOTES
        head = notes.read_text(encoding="utf-8").split(MARKER, 1)[0]
        notes.write_text(head + MARKER + "\n", encoding="utf-8")
        subprocess.run(["git", "init", "-q"], cwd=self.root, check=True)
        subprocess.run(["git", "add", "-A"], cwd=self.root, check=True)
        self.version = read_version(self.root / "package.json")

    def close(self) -> None:
        self._dir.cleanup()

    def check(self) -> subprocess.CompletedProcess[str]:
        """Stage the copy, as a commit would, then run the check."""
        subprocess.run(["git", "add", "-A"], cwd=self.root, check=True)
        return subprocess.run(
            [sys.executable, str(self.root / "scripts/check_version_sot.py")],
            cwd=self.root, capture_output=True, text=True, check=False,
        )

    def append(self, rel: str, text: str) -> None:
        path = self.root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as handle:
            handle.write(text)

    def publish(self, body: str, version: str | None = None) -> None:
        """Append a release section below the marker, as towncrier does."""
        title = _release_title(version or self.version)
        self.append(
            NOTES,
            f"\n{title}\n{'-' * len(title)}\n\nFeatures\n~~~~~~~~\n\n"
            f"- {body}\n",
        )

    def bump(self, new: str) -> None:
        """Move package.json and the cog output to a new version.

        A new major also moves the live workflow pins above the marker.
        The scripts directory keeps its text, since a release does not
        edit the check, and a pin example there must fail the test.
        """
        old = self.version
        manifest = self.root / "package.json"
        data = json.loads(manifest.read_text(encoding="utf-8"))
        data["version"] = new
        manifest.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
        old_out, new_out = _cog_outputs(old), _cog_outputs(new)
        for rel in old_out:
            path = self.root / rel
            text = path.read_text(encoding="utf-8")
            path.write_text(
                text.replace(old_out[rel], new_out[rel]), encoding="utf-8"
            )
        old_major, new_major = major_version(old), major_version(new)
        if old_major != new_major:
            live = re.compile(
                "(" + "|".join(map(re.escape, LIVE_PIN_PREFIXES)) + ")"
                + re.escape(old_major) + r"(?![0-9.])"
            )
            for path in self.root.rglob("*"):
                rel = path.relative_to(self.root)
                if not path.is_file() or rel.parts[0] in (".git", "scripts"):
                    continue
                try:
                    text = path.read_text(encoding="utf-8")
                except UnicodeDecodeError:
                    continue
                head, sep, tail = text.partition(MARKER)
                moved = live.sub(lambda m: m.group(1) + new_major, head)
                if moved != head:
                    path.write_text(moved + sep + tail, encoding="utf-8")
        self.version = new


def _next_patch(version: str) -> str:
    major, minor, patch = version.split(".")
    return f"{major}.{minor}.{int(patch) + 1}"


def _next_major(version: str) -> str:
    return f"{int(major_version(version)) + 1}.0.0"


# A whole version token in the scanned sources, the shape the copy scan
# counts. Text inside links to other sites is stripped first, as the
# check does.
VERSION_TOKEN = re.compile(r"(?<![0-9.])[0-9]+\.[0-9]+\.[0-9]+(?![0-9]|\.[0-9])")


def _versions_in_check_sources() -> set[str]:
    found: set[str] = set()
    for name in ("check_version_sot.py", "project_version.py", Path(__file__).name):
        text = (ROOT / "scripts" / name).read_text(encoding="utf-8")
        found.update(VERSION_TOKEN.findall(scan_text(text)))
    return found


def _docs_prefix(root: Path) -> str:
    """Return html_baseurl from the docs configuration, without the scheme."""
    tree = ast.parse((root / DOCS_CONF).read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(
            getattr(target, "id", None) == "html_baseurl"
            for target in node.targets
        ):
            return node.value.value.split("://", 1)[1].rstrip("/")
    raise AssertionError(f"{DOCS_CONF} sets no html_baseurl")


class CheckTest(unittest.TestCase):
    """Shared setup: a scratch checkout and pass or fail assertions."""

    def setUp(self) -> None:
        self.repo = Checkout()
        self.addCleanup(self.repo.close)

    def assertPasses(self) -> None:
        result = self.repo.check()
        self.assertEqual(result.returncode, 0, result.stderr)

    def assertFails(self, needle: str) -> None:
        result = self.repo.check()
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn(needle, result.stderr)


class VersionCheckTest(CheckTest):
    def test_base_passes(self) -> None:
        self.assertPasses()

    def test_patch_bump_ignores_other_package_pin(self) -> None:
        new = _next_patch(self.repo.version)
        self.repo.append(DOC, f"uvx --from asv-spyglass=={new}\n")
        self.repo.bump(new)
        self.assertPasses()

    def test_bump_ignores_dependency_range(self) -> None:
        new = _next_patch(self.repo.version)
        manifest = self.repo.root / "package.json"
        data = json.loads(manifest.read_text(encoding="utf-8"))
        data["dependencies"]["example"] = "^" + new
        manifest.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
        self.repo.bump(new)
        self.assertPasses()

    def test_hand_written_copy_fails(self) -> None:
        self.repo.append(DOC, f"Install asv-perch {self.repo.version}.\n")
        self.assertFails(f"{DOC} contains the project version")

    def test_org_literal_copy_fails(self) -> None:
        # org markup wraps verbatim text in = and code text in ~.
        for mark in ("=", "~"):
            with self.subTest(mark=mark):
                repo = Checkout()
                self.addCleanup(repo.close)
                repo.append(DOC, f"Install {mark}{repo.version}{mark}.\n")
                result = repo.check()
                self.assertNotEqual(result.returncode, 0, result.stdout)
                self.assertIn(f"{DOC} contains the project version", result.stderr)

    def test_specifier_for_other_package_passes(self) -> None:
        for op in ("==", ">="):
            with self.subTest(op=op):
                repo = Checkout()
                self.addCleanup(repo.close)
                repo.append(DOC, f"uvx --from 'asv-spyglass{op}{repo.version}'\n")
                result = repo.check()
                self.assertEqual(result.returncode, 0, result.stderr)

    def test_docs_site_link_is_scanned(self) -> None:
        prefixes = _project_url_prefixes(self.repo.root)
        self.assertIn(_docs_prefix(self.repo.root), prefixes)
        for prefix in prefixes:
            with self.subTest(prefix=prefix):
                repo = Checkout()
                self.addCleanup(repo.close)
                repo.append(DOC, f"See https://{prefix}/v{repo.version}/.\n")
                result = repo.check()
                self.assertNotEqual(result.returncode, 0, result.stdout)
                self.assertIn(f"{DOC} contains the project version", result.stderr)

    def test_partial_pin_fails(self) -> None:
        major, minor, _patch = self.repo.version.split(".")
        self.repo.append(DOC, f"- uses: HaoZeke/{PIN}{major}.{minor}\n")
        self.assertFails(f"pins v{major}.{minor}")

    def test_major_and_full_pins_pass(self) -> None:
        major = major_version(self.repo.version)
        self.repo.append(DOC, f"- uses: HaoZeke/{PIN}{major}\n")
        self.repo.append(DOC, f"- uses: HaoZeke/{PIN}{self.repo.version}\n")
        self.assertPasses()

    def test_duplicate_release_heading_fails(self) -> None:
        self.repo.publish("first build")
        self.repo.publish("second build")
        self.assertFails("second release heading")

    def test_published_full_pin_survives_patch_bump(self) -> None:
        self.repo.publish(f"Pin HaoZeke/{PIN}{self.repo.version} to test.")
        self.repo.bump(_next_patch(self.repo.version))
        self.assertPasses()

    def test_published_major_pins_survive_major_bump(self) -> None:
        major = major_version(self.repo.version)
        self.repo.publish(
            f"Workflows use HaoZeke/{PIN}{major} and {PROSE_PIN}{major}=."
        )
        self.repo.bump(_next_major(self.repo.version))
        self.assertPasses()

    def test_live_pin_above_marker_still_fails_after_major_bump(self) -> None:
        old_major = major_version(self.repo.version)
        self.repo.append(DOC, f"- uses: HaoZeke/{PIN}{old_major}\n")
        new = _next_major(self.repo.version)
        self.repo.bump(new)
        self.repo.append(DOC, f"- uses: HaoZeke/{PIN}{old_major}\n")
        self.assertFails(f"pins v{old_major}, canonical is {new}")

    def test_extensionless_and_cff_files_are_scanned(self) -> None:
        self.repo.append("CITATION.cff", f"version: {self.repo.version}\n")
        self.repo.append("VERSION", f"{self.repo.version}\n")
        result = self.repo.check()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("CITATION.cff contains the project version", result.stderr)
        self.assertIn("VERSION contains the project version", result.stderr)

    def test_binary_and_ignored_files_are_skipped(self) -> None:
        copy = self.repo.version.encode("ascii")
        (self.repo.root / "blob.bin").write_bytes(b"\0" + copy)
        (self.repo.root / "latin1.txt").write_bytes(b"\xff\xfe " + copy)
        self.repo.append(".venv-version/lib/site.py", f"{self.repo.version}\n")
        self.assertPasses()

    def test_untracked_files_are_skipped(self) -> None:
        self.repo.append(".venv/lib/site.py", f"{self.repo.version}\n")
        result = subprocess.run(
            [sys.executable, str(self.repo.root / "scripts/check_version_sot.py")],
            cwd=self.repo.root, capture_output=True, text=True, check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)


class ReleaseHeadingTest(CheckTest):
    def test_earlier_release_heading_passes(self) -> None:
        self.repo.publish("first release")
        self.repo.bump(_next_patch(self.repo.version))
        self.repo.publish("second release")
        self.assertPasses()

    def test_later_release_heading_fails(self) -> None:
        later = _next_patch(self.repo.version)
        self.repo.publish("not released yet", version=later)
        self.assertFails(f"release heading for {later}, later than package.json")

    def test_heading_order_is_numeric(self) -> None:
        # The heading patch is all nines and the new patch has one more
        # digit, so the heading sorts after the new version as text and
        # before it as a number.
        major, minor, patch = self.repo.version.split(".")
        digits = len(str(int(patch) + 1))
        new = f"{major}.{minor}.{10 ** digits}"
        self.repo.bump(new)
        self.repo.publish("earlier", version=f"{major}.{minor}.{10 ** digits - 1}")
        self.assertPasses()

    def test_short_version_heading_fails(self) -> None:
        major, minor, _patch = self.repo.version.split(".")
        self.repo.publish("short", version=f"{major}.{minor}")
        self.assertFails("not MAJOR.MINOR.PATCH")

    def test_heading_above_marker_fails(self) -> None:
        notes = self.repo.root / NOTES
        title = _release_title(self.repo.version)
        text = notes.read_text(encoding="utf-8")
        notes.write_text(
            text.replace(MARKER, f"{title}\n{'-' * len(title)}\n\n{MARKER}"),
            encoding="utf-8",
        )
        self.assertFails("release heading above the towncrier marker")


# Versions of other software in the checkout when the scan was scoped:
# the cogapp and towncrier pins in scripts/requirements-version-sot.txt,
# the hook revs in .pre-commit-config.yaml, SVG path data in the docs
# site footer, the kernel in the recorded test fixtures and the
# setup-pixi action ref.
# They are number tuples so this file holds no copy of them.
UNRELATED_VERSIONS = tuple(
    ".".join(map(str, parts))
    for parts in (
        (3, 6, 0), (26, 9, 0), (5, 0, 0), (9, 21, 0), (9, 9, 3), (6, 11, 9),
        (0, 8, 10),
    )
)
SITE_FOOT = "docs/source/_templates/partials/site-foot.html"


class ScanScopeTest(unittest.TestCase):
    """The copy scan counts only text that can mean this project."""

    def test_unrelated_versions_pass(self) -> None:
        for target in UNRELATED_VERSIONS:
            with self.subTest(version=target):
                repo = Checkout()
                self.addCleanup(repo.close)
                repo.bump(target)
                result = repo.check()
                self.assertEqual(result.returncode, 0, result.stderr)

    def test_own_copies_still_fail(self) -> None:
        for target in UNRELATED_VERSIONS:
            with self.subTest(version=target):
                repo = Checkout()
                self.addCleanup(repo.close)
                repo.bump(target)
                repo.append(DOC, f"Install asv-perch {target}.\n")
                repo.append(SITE_FOOT, f"<p>Release {target}</p>\n")
                repo.append("CITATION.cff", f"version: {target}\n")
                result = repo.check()
                self.assertNotEqual(result.returncode, 0, result.stdout)
                for rel in (DOC, SITE_FOOT, "CITATION.cff"):
                    self.assertIn(f"{rel} contains the project version", result.stderr)


class OwnSourceTest(CheckTest):
    """The check and its tests must pass at any version they mention."""

    def test_examples_and_own_versions_pass(self) -> None:
        # Longer numbers around the next patch, the cases the token
        # docstring describes: an extra leading digit and an extra
        # trailing digit.
        # The next major checks that no pin example in the check sources
        # names the current major, since bump() leaves scripts alone.
        base = _next_patch(self.repo.version)
        targets = {"1" + base, base + "0", _next_major(self.repo.version)}
        targets |= _versions_in_check_sources()
        for target in sorted(targets):
            with self.subTest(version=target):
                repo = Checkout()
                self.addCleanup(repo.close)
                repo.bump(target)
                result = repo.check()
                self.assertEqual(result.returncode, 0, result.stderr)


class TowncrierBuildArgsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.repo = Checkout()
        self.addCleanup(self.repo.close)

    def test_caller_version_is_rejected(self) -> None:
        other = _next_patch(self.repo.version)
        notes = (self.repo.root / NOTES).read_text(encoding="utf-8")
        for args in (["--version", other], [f"--version={other}"]):
            with self.subTest(args=args):
                result = subprocess.run(
                    ["sh", str(self.repo.root / "scripts/towncrier_build.sh"),
                     "--draft", *args],
                    cwd=self.repo.root, capture_output=True, text=True,
                    check=False,
                )
                self.assertEqual(result.returncode, 2, result.stderr)
                self.assertIn("the version comes from package.json", result.stderr)
                self.assertFalse((self.repo.root / ".venv-version").exists())
                self.assertEqual(
                    (self.repo.root / NOTES).read_text(encoding="utf-8"), notes
                )


if __name__ == "__main__":
    unittest.main()
