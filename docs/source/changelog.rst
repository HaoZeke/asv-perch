Changelog
=========

Release notes are collected with `towncrier <https://towncrier.readthedocs.io/en/stable/>`_.
Fragments live in ``changelog.d/``. ``towncrier.toml`` does not store a version.
``scripts/towncrier_build.sh`` reads ``package.json`` and passes ``--version``
(https://towncrier.readthedocs.io/en/stable/tutorial.html#detecting-version).

The link below is generated with `cog <https://cog.readthedocs.io/en/latest/>`_.

.. [[[cog
   import pathlib
   import sys
   import cog
   root = pathlib.Path("package.json").resolve().parent
   sys.path.insert(0, str(root / "scripts"))
   from project_version import changelog_cog_output, read_version
   version = read_version(root / "package.json")
   cog.out(changelog_cog_output(version))

.. ]]]

Current release: `1.2.2 <https://github.com/HaoZeke/asv-perch/releases/tag/v1.2.2>`_.

.. [[[end]]]

.. towncrier release notes start
