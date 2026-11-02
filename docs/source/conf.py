import sys
from pathlib import Path

# docs/source/conf.py is two directories below the repository root.
_REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO_ROOT / "scripts"))
from project_version import read_version, short_version

project = "asv-perch"
copyright = "2026--present, Rohit Goswami"
author = "Rohit Goswami"

# release is the full package.json version. version is the Sphinx short
# X.Y form. Both are read at build time, not written here.
# https://www.sphinx-doc.org/en/master/usage/configuration.html#confval-release
release = read_version(_REPO_ROOT / "package.json")
version = short_version(release)

extensions = [
    "sphinx.ext.intersphinx",
    "sphinx_sitemap",
]

templates_path = ["_templates"]
exclude_patterns = []

intersphinx_mapping = {
    "python": ("https://docs.python.org/3", None),
}

html_theme = "shibuya"
html_static_path = ["_static"]
html_theme_options = {
    "github_url": "https://github.com/HaoZeke/asv-perch",
    "accent_color": "teal",
    "dark_code": True,
    "globaltoc_expand_depth": 1,
    "nav_links": [
        {
            "title": "Ecosystem",
            "children": [
                {
                    "title": "ASV",
                    "url": "https://github.com/airspeed-velocity/asv",
                    "summary": "Airspeed Velocity benchmarking",
                },
                {
                    "title": "asv-spyglass",
                    "url": "https://github.com/airspeed-velocity/asv_spyglass",
                    "summary": "File-oriented ASV comparisons",
                },
                {
                    "title": "asv_runner",
                    "url": "https://github.com/airspeed-velocity/asv_runner",
                    "summary": "ASV benchmark runner",
                },
                {
                    "title": "asv_samples",
                    "url": "https://github.com/airspeed-velocity/asv_samples",
                    "summary": "Sample ASV benchmarks",
                },
            ],
        },
    ],
}

html_baseurl = "https://asv-perch.rgoswami.me/"

html_context = {
    "source_type": "github",
    "source_user": "HaoZeke",
    "source_repo": "asv-perch",
    "source_version": "main",
    "source_docs_path": "/docs/source/",
}

html_sidebars = {
    "**": [
        "sidebars/localtoc.html",
        "sidebars/repo-stats.html",
        "sidebars/edit-this-page.html",
    ],
}
