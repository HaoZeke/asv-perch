
# Table of Contents

1.  [About](#org77670d2)
2.  [Quick Start (Two-Way)](#org872d71b)
3.  [Quick Start (Multi-Way)](#orgfb5138c)
4.  [Quick Start (Full Pipeline &#x2013; Single Job)](#orgc6d83bc)
5.  [Essential Inputs](#org0d004c8)
6.  [Why This Action](#org571d130)
    1.  [Outputs](#orgc964c6a)
7.  [Development](#orgfaf2a5f)
8.  [License](#org04a8b14)



<a id="org77670d2"></a>

# About

[![CI](https://github.com/HaoZeke/asv-perch/actions/workflows/ci.yml/badge.svg)](https://github.com/HaoZeke/asv-perch/actions/workflows/ci.yml)
[![Docs](https://github.com/HaoZeke/asv-perch/actions/workflows/ci_docs.yml/badge.svg)](https://asv-perch.rgoswami.me)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A GitHub Action that posts ASV benchmark comparison results as PR comments with
Mann-Whitney U statistical significance testing, rich GFM formatting, and
multi-way comparison support. Built on [asv-spyglass](https://github.com/airspeed-velocity/asv_spyglass).

The action can run benchmarks and post results in one step, or work as a pure
presentation layer with pre-existing result files. Either way, it never manages
your build environment &#x2013; use conda, pixi, virtualenv, nix, Docker, GPU
runners, or whatever you need.

<p align="center">
  <img src="https://raw.githubusercontent.com/HaoZeke/asv-perch/main/docs/images/pr-comment.jpg"
       alt="asv-perch PR comment with regressions and improvements"
       width="920" />
</p>

<p align="center"><em>What lands on the PR: emoji summary, ratio tables, Mann-Whitney aware marks</em></p>

| Multi-way PR table | Same ratios in asv-tachyon |
|:---:|:---:|
| <img src="https://raw.githubusercontent.com/HaoZeke/asv-perch/main/docs/images/pr-comment-many.jpg" alt="Multi-way compare PR comment" width="440" /> | <img src="https://raw.githubusercontent.com/HaoZeke/asv-perch/main/docs/images/tachyon-compare.jpg" alt="asv-tachyon Compare view" width="440" /> |
| `compare-many` contenders in one comment | Explore/Compare on the published site |

Pair with [asv-tachyon](https://github.com/HaoZeke/asv_tachyon) for the
local/published dashboard (Overview · Compare · Inventory) and
[asv-spyglass](https://github.com/airspeed-velocity/asv_spyglass) for the CLI
that powers both.


<a id="org872d71b"></a>

# Quick Start (Two-Way)

    - uses: HaoZeke/asv-perch@v1
      with:
        github-token: ${{ secrets.GITHUB_TOKEN }}
        results-path: results/
        metadata-file: results/metadata.txt


<a id="orgfb5138c"></a>

# Quick Start (Multi-Way)

    - uses: HaoZeke/asv-perch@v1
      with:
        github-token: ${{ secrets.GITHUB_TOKEN }}
        results-path: results/
        comparison-mode: compare-many
        baseline-sha: ${{ env.BASELINE_SHA }}
        contender-shas: '${{ env.OPT_SHA }}, ${{ env.DEBUG_SHA }}'
        contender-labels: 'optimized, debug'


<a id="orgc6d83bc"></a>

# Quick Start (Full Pipeline &#x2013; Single Job)

Run benchmarks and compare in one step. The action handles git checkout
(`preserve-paths`), environment activation (`run-prefix` or `setup`), and
the ASV invocation automatically.

    - uses: prefix-dev/setup-pixi@v0.8.10
      with:
        activate-environment: true
    - uses: HaoZeke/asv-perch@v1
      with:
        github-token: ${{ secrets.GITHUB_TOKEN }}
        results-path: .asv/results/
        init-command: pixi run bash -c "pip install asv && asv machine --yes"
        preserve-paths: benchmarks/, asv.conf.json
        benchmark-command: >-
          asv run -E "existing:$(which python)"
          --set-commit-hash {sha} --record-samples --quick
        baseline: |
          label: main
          sha: ${{ github.event.pull_request.base.sha }}
          setup: >-
            pixi run bash -c "meson setup bbdir
            --prefix=$CONDA_PREFIX --libdir=lib
            --buildtype release --wipe 2>/dev/null
            || meson setup bbdir --prefix=$CONDA_PREFIX
            --libdir=lib --buildtype release" &&
            pixi run meson install -C bbdir
          run-prefix: pixi run
        contenders: |
          - label: pr
            sha: ${{ github.event.pull_request.head.sha }}
            setup: >-
              pixi run bash -c "meson setup bbdir
              --prefix=$CONDA_PREFIX --libdir=lib
              --buildtype release --wipe 2>/dev/null
              || meson setup bbdir --prefix=$CONDA_PREFIX
              --libdir=lib --buildtype release" &&
              pixi run meson install -C bbdir
            run-prefix: pixi run
        label-before: main
        label-after: pr

For pure Python projects with `run-prefix` only (no build step):

    - uses: HaoZeke/asv-perch@v1
      with:
        github-token: ${{ secrets.GITHUB_TOKEN }}
        results-path: .asv/results/
        baseline: |
          label: main
          sha: ${{ env.BASE_SHA }}
          run-prefix: pixi run -e bench
        contenders: |
          - label: pr
            sha: ${{ env.PR_SHA }}
            run-prefix: pixi run -e bench


<a id="org0d004c8"></a>

# Essential Inputs

<table border="2" cellspacing="0" cellpadding="6" rules="groups" frame="hsides">


<colgroup>
<col  class="org-left" />

<col  class="org-left" />

<col  class="org-left" />

<col  class="org-left" />
</colgroup>
<thead>
<tr>
<th scope="col" class="org-left">Input</th>
<th scope="col" class="org-left">Required</th>
<th scope="col" class="org-left">Default</th>
<th scope="col" class="org-left">Description</th>
</tr>
</thead>
<tbody>
<tr>
<td class="org-left"><code>github-token</code></td>
<td class="org-left">yes</td>
<td class="org-left"><code>${{ github.token }}</code></td>
<td class="org-left">GitHub token for API access</td>
</tr>

<tr>
<td class="org-left"><code>results-path</code></td>
<td class="org-left">conditional</td>
<td class="org-left">--</td>
<td class="org-left">Path to ASV results dir (not needed with <code>comparison-text-file</code>)</td>
</tr>

<tr>
<td class="org-left"><code>comparison-text-file</code></td>
<td class="org-left">no</td>
<td class="org-left">--</td>
<td class="org-left">Pre-computed comparison output (skips asv-spyglass)</td>
</tr>

<tr>
<td class="org-left"><code>comparison-mode</code></td>
<td class="org-left">no</td>
<td class="org-left"><code>compare</code></td>
<td class="org-left"><code>compare</code> (two-way) or <code>compare-many</code> (multi-way)</td>
</tr>

<tr>
<td class="org-left"><code>base-sha</code> / <code>pr-sha</code></td>
<td class="org-left">conditional</td>
<td class="org-left">--</td>
<td class="org-left">SHAs for <code>compare</code> mode</td>
</tr>

<tr>
<td class="org-left"><code>base-file</code> / <code>pr-file</code></td>
<td class="org-left">conditional</td>
<td class="org-left">--</td>
<td class="org-left">Direct file paths for <code>compare</code> mode</td>
</tr>

<tr>
<td class="org-left"><code>baseline-sha</code></td>
<td class="org-left">conditional</td>
<td class="org-left">--</td>
<td class="org-left">SHA for <code>compare-many</code> baseline</td>
</tr>

<tr>
<td class="org-left"><code>contender-shas</code></td>
<td class="org-left">conditional</td>
<td class="org-left">--</td>
<td class="org-left">Comma-separated SHAs for <code>compare-many</code> contenders</td>
</tr>

<tr>
<td class="org-left"><code>baseline-file</code></td>
<td class="org-left">conditional</td>
<td class="org-left">--</td>
<td class="org-left">Direct path to baseline result JSON</td>
</tr>

<tr>
<td class="org-left"><code>contender-files</code></td>
<td class="org-left">conditional</td>
<td class="org-left">--</td>
<td class="org-left">Comma-separated direct paths to contender JSONs</td>
</tr>

<tr>
<td class="org-left"><code>contender-labels</code></td>
<td class="org-left">no</td>
<td class="org-left">--</td>
<td class="org-left">Comma-separated labels for contenders</td>
</tr>

<tr>
<td class="org-left"><code>baseline</code></td>
<td class="org-left">no</td>
<td class="org-left">--</td>
<td class="org-left">YAML config for baseline (label, sha, run-prefix/setup)</td>
</tr>

<tr>
<td class="org-left"><code>contenders</code></td>
<td class="org-left">no</td>
<td class="org-left">--</td>
<td class="org-left">YAML list of contenders (label, sha, run-prefix/setup)</td>
</tr>

<tr>
<td class="org-left"><code>benchmark-command</code></td>
<td class="org-left">no</td>
<td class="org-left"><code>asv run --record-samples {sha}^!</code></td>
<td class="org-left">Shell command template; <code>{sha}</code> replaced in all fields</td>
</tr>

<tr>
<td class="org-left"><code>init-command</code></td>
<td class="org-left">no</td>
<td class="org-left">--</td>
<td class="org-left">One-time setup before benchmarks (e.g. <code>asv machine --yes</code>)</td>
</tr>

<tr>
<td class="org-left"><code>preserve-paths</code></td>
<td class="org-left">no</td>
<td class="org-left">--</td>
<td class="org-left">Paths to preserve across git checkouts (e.g. <code>benchmarks/, asv.conf.json</code>)</td>
</tr>

<tr>
<td class="org-left"><code>asv-spyglass-args</code></td>
<td class="org-left">no</td>
<td class="org-left">--</td>
<td class="org-left">Extra flags for asv-spyglass CLI</td>
</tr>

<tr>
<td class="org-left"><code>regression-threshold</code></td>
<td class="org-left">no</td>
<td class="org-left"><code>10</code></td>
<td class="org-left">Ratio for critical regression</td>
</tr>

<tr>
<td class="org-left"><code>auto-draft-on-regression</code></td>
<td class="org-left">no</td>
<td class="org-left"><code>false</code></td>
<td class="org-left">Convert PR to draft on regression</td>
</tr>
</tbody>
</table>

See [full documentation](https://asv-perch.rgoswami.me) for all
inputs, outputs, and configuration details.


<a id="org571d130"></a>

# Why This Action

-   **Statistical rigor:** Mann-Whitney U test + 99% confidence intervals via ASV,
    not naive ratio comparison
-   **Environment freedom:** The action never touches your build system. Run ASV in
    conda, pixi, nix, Docker, GPU runners &#x2013; whatever you need
-   **Multi-way comparison:** Compare a baseline against multiple build configs or
    environments in a single table

See [the
full comparison](https://asv-perch.rgoswami.me/explanation/why_this_action.html) with CodSpeed, benchmark-action, and inline scripts.


<a id="orgc964c6a"></a>

## Outputs

<table border="2" cellspacing="0" cellpadding="6" rules="groups" frame="hsides">


<colgroup>
<col  class="org-left" />

<col  class="org-left" />
</colgroup>
<thead>
<tr>
<th scope="col" class="org-left">Output</th>
<th scope="col" class="org-left">Description</th>
</tr>
</thead>
<tbody>
<tr>
<td class="org-left"><code>comparison</code></td>
<td class="org-left">Raw asv-spyglass comparison output</td>
</tr>

<tr>
<td class="org-left"><code>regression-detected</code></td>
<td class="org-left"><code>'true'</code> or <code>'false'</code></td>
</tr>

<tr>
<td class="org-left"><code>comment-id</code></td>
<td class="org-left">ID of created/updated comment</td>
</tr>

<tr>
<td class="org-left"><code>pr-number</code></td>
<td class="org-left">Number of the associated PR</td>
</tr>
</tbody>
</table>


<a id="orgfaf2a5f"></a>

# Development

Built with [bun](https://bun.sh) and TypeScript.

    bun install
    bun run build      # tsc + vite
    bun run test       # vitest
    bun run lint       # eslint
    bun run typecheck  # tsc --noEmit


<a id="org04a8b14"></a>

# License

MIT

