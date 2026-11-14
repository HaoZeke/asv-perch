<!-- asv-benchmark-result -->
## Benchmark Results

> [!WARNING]
> **2 benchmark(s) slower**

Smallest change this run can resolve: 4.0%.

| | Count |
|---|---:|
| :red_circle: Slower | 2 |
| :green_circle: Faster | 1 |
| :white_circle: Unchanged | 2 |
| :warning: Failed | 1 |

### Slower

| | Benchmark | Verdict | Ratio (95% CI) | Rounds | A/A |
|---|---|---|--:|--:|--:|
| :red_circle: | `bench.time_slow` | slower | 1.03 [1.02, 1.04] | 6 | 1.00 [0.99, 1.01] |
| :red_circle: | `group.time_grid(left, 2)` | slower | 1.20 [1.15, 1.25] | 11 | 1.00 [0.97, 1.04] |

### Faster

| | Benchmark | Verdict | Ratio (95% CI) | Rounds | A/A |
|---|---|---|--:|--:|--:|
| :green_circle: | `bench.time_fast` | faster | 0.90 [0.88, 0.92] | 6 | 1.00 [0.99, 1.01] |

### Failed

| | Benchmark | Verdict | Ratio (95% CI) | Rounds | A/A |
|---|---|---|--:|--:|--:|
| :warning: | `bench.time_fail` | failed | n/a | n/a | n/a |

<details>
<summary>2 unchanged benchmark(s)</summary>

| Benchmark | Verdict | Ratio (95% CI) | Rounds | A/A |
|---|---|--:|--:|--:|
| `bench.time_same` | unchanged | 1.00 [0.99, 1.01] | 20 | 1.00 [0.98, 1.02] |
| `group.time_grid(right, 1)` | unchanged | 1.01 [1.00, 1.02] | 20 | 1.00 [0.99, 1.01] |

</details>

<details>
<summary>Details</summary>

- **Base:** `aaaaaaaa`
- **Head:** `bbbbbbbb`
- **Runner:** `ubuntu-22.04`

</details>

<details>
<summary>Raw asv compare output</summary>

```
{
  "schema_version": 1,
  "before": {
    "commit": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "label": "<main>"
  },
  "after": {
    "commit": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "label": "<pr>"
  },
  "records": [
    {
      "name": "bench.time_slow",
      "params": [],
      "machine": "ci",
      "environment": "virtualenv-py3.12",
      "before": { "median": 0.00201, "unit": "seconds" },
      "after": { "median": 0.00207, "unit": "seconds" },
      "ratio": 1.03,
      "ratio_ci": [1.03, 1.02, 1.04],
      "rounds": 6,
      "verdict": "slower",
      "aa_band": [1.0, 0.99, 1.01]
    },
    {
      "name": "bench.time_fast",
      "params": [],
      "machine": "ci",
      "environment": "virtualenv-py3.12",
      "before": { "median": 0.0022, "unit": "seconds" },
      "after": { "median": 0.00198, "unit": "seconds" },
      "ratio": 0.9,
      "ratio_ci": [0.9, 0.88, 0.92],
      "rounds": 6,
      "verdict": "faster",
      "aa_band": [1.0, 0.99, 1.01]
    },
    {
      "name": "bench.time_same",
      "params": [],
      "machine": "ci",
      "environment": "virtualenv-py3.12",
      "before": { "median": 0.002, "unit": "seconds" },
      "after": { "median": 0.002, "unit": "seconds" },
      "ratio": 1.0,
      "ratio_ci": [1.0, 0.99, 1.01],
      "rounds": 20,
      "verdict": "unchanged",
      "aa_band": [1.0, 0.98, 1.02]
    },
    {
      "name": "bench.time_fail",
      "params": [],
      "machine": "ci",
      "environment": "virtualenv-py3.12",
      "before": { "median": null, "unit": "seconds" },
      "after": { "median": null, "unit": "seconds" },
      "ratio": null,
      "ratio_ci": null,
      "rounds": null,
      "verdict": "failed",
      "aa_band": null
    },
    {
      "name": "group.time_grid",
      "params": ["left", "2"],
      "machine": "ci",
      "environment": "virtualenv-py3.12",
      "before": { "median": 0.004, "unit": "seconds" },
      "after": { "median": 0.0048, "unit": "seconds" },
      "ratio": 1.2,
      "ratio_ci": [1.2, 1.15, 1.25],
      "rounds": 11,
      "verdict": "slower",
      "aa_band": [1.0, 0.97, 1.04]
    },
    {
      "name": "group.time_grid",
      "params": ["right", "1"],
      "machine": "ci",
      "environment": "virtualenv-py3.12",
      "before": { "median": 0.003, "unit": "seconds" },
      "after": { "median": 0.00303, "unit": "seconds" },
      "ratio": 1.01,
      "ratio_ci": [1.01, 1.0, 1.02],
      "rounds": 20,
      "verdict": "unchanged",
      "aa_band": [1.0, 0.99, 1.01]
    }
  ]
}
```

</details>
