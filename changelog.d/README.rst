News fragments
==============

Add a file here before a release, then build the changelog with
``scripts/towncrier_build.sh``. That script reads ``package.json`` and
passes ``--version``. Towncrier does not keep a second copy of the version
(https://towncrier.readthedocs.io/en/stable/tutorial.html#detecting-version).

The filename is ``<issue>.<type>.rst``, or ``+<slug>.<type>.rst`` when
there is no issue number. ``+`` is towncrier's orphan prefix
(https://towncrier.readthedocs.io/en/stable/configuration.html).

Default types are ``feature``, ``bugfix``, ``doc``, ``removal``, and
``misc``.
