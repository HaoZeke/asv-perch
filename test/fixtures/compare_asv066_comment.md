<!-- asv-benchmark-result -->
## Benchmark Results

> [!NOTE]
> **Significance is unknown** for 1 benchmark(s)

This table has no ratio interval, so significance is unknown.

| | Count |
|---|---:|
| :white_circle: Unchanged | 1 |
| :question: Significance unknown | 1 |

### Significance unknown

| Benchmark | Before | After | Ratio |
|---|--:|--:|--:|
| `bench.time_slow` | 2.01±0ms | 2.07±0.01ms | 1.03x |

<details>
<summary>1 unchanged benchmark(s)</summary>

| Benchmark | Before | After | Ratio |
|---|--:|--:|--:|
| `bench.time_same` | 2.01±0.01ms | 2.01±0.01ms | 1x |

</details>

<details>
<summary>Details</summary>

- **Base:** `2bd67fb2`
- **Head:** `08d496fd`
- **Runner:** `e2e`

</details>

<details>
<summary>Raw asv-spyglass output</summary>

```
All benchmarks:

| Change   | Before [2bd67fb2] <main~1>   | After [08d496fd] <main>   |   Ratio | Benchmark (Parameter)   |
|----------|------------------------------|---------------------------|---------|-------------------------|
|          | 2.01±0.01ms                  | 2.01±0.01ms               |    1    | bench.time_same         |
|          | 2.01±0ms                     | 2.07±0.01ms               |    1.03 | bench.time_slow         |
```

</details>
