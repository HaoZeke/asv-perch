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
    "eon": ("https://eondocs.org", None),
}

html_theme = "shibuya"
html_static_path = ["_static"]
html_theme_options = {
    "github_url": "https://github.com/HaoZeke/asv-perch",
}

html_baseurl = "https://haozeke.github.io/asv-perch/"
