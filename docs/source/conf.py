project = "asv-perch"
copyright = "2026--present, Rohit Goswami"
author = "Rohit Goswami"

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
