<!-- asv-benchmark-result -->
## Benchmark Results

> [!WARNING]
> **1 benchmark(s) slower**

Smallest change this run can resolve: any nonzero change.

| | Count |
|---|---:|
| :red_circle: Slower | 1 |
| :white_circle: Unchanged | 1 |

### Slower

| | Benchmark | Verdict | Ratio (95% CI) | Rounds | A/A |
|---|---|---|--:|--:|--:|
| :red_circle: | `bench.Mem.ray_grow (bytes)` | slower | 1.05 [1.05, 1.05] | 6 | 1.00 [1.00, 1.00] |

<details>
<summary>1 unchanged benchmark(s)</summary>

| Benchmark | Verdict | Ratio (95% CI) | Rounds | A/A |
|---|---|--:|--:|--:|
| `bench.Mem.ray_same (bytes)` | unchanged | 1.00 [1.00, 1.00] | 20 | 1.00 [1.00, 1.00] |

</details>

<details>
<summary>Details</summary>

- **Base:** `5d0a09f1`
- **Head:** `f592bdc3`
- **Runner:** `e2e`

</details>

<details>
<summary>Raw asv compare output</summary>

```
{
  "schema_version": 1,
  "before": {
    "commit": "5d0a09f1239da03592b5d3c399b8818dc8967227",
    "label": "<main~1>"
  },
  "after": {
    "commit": "f592bdc333c3669da43c353f28fdceaf94db5ca1",
    "label": "<main>"
  },
  "records": [
    {
      "name": "bench.Mem.ray_grow",
      "params": [],
      "machine": "ci",
      "environment": "virtualenv-py3.12-asv_bench_memray",
      "before": {
        "median": 8000001.0,
        "unit": "bytes"
      },
      "after": {
        "median": 8400001.0,
        "unit": "bytes"
      },
      "ratio": 1.0499999937500009,
      "ratio_ci": [
        1.0499999937500009,
        1.0499999937500009,
        1.0499999937500009
      ],
      "rounds": 6,
      "verdict": "slower",
      "aa_band": [
        1.0,
        1.0,
        1.0
      ]
    },
    {
      "name": "bench.Mem.ray_same",
      "params": [],
      "machine": "ci",
      "environment": "virtualenv-py3.12-asv_bench_memray",
      "before": {
        "median": 8000001.0,
        "unit": "bytes"
      },
      "after": {
        "median": 8000001.0,
        "unit": "bytes"
      },
      "ratio": 1.0,
      "ratio_ci": [
        1.0,
        1.0,
        1.0
      ],
      "rounds": 20,
      "verdict": "unchanged",
      "aa_band": [
        1.0,
        1.0,
        1.0
      ]
    }
  ]
}
```

</details>
