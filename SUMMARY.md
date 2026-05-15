# Flink TaskManager Memory Calculator

## Task

Build a static HTML page that lets the user modify any TaskManager memory
configuration parameter and see the resulting effective sizes (Total Process
Memory, Total Flink Memory, Framework/Task Heap, Network, Managed, Metaspace,
Overhead), using **exactly the same logic** Flink's Java code uses. Present
the output similar to the Flink Web UI's TaskManager memory page.

## Result

`index.html` — single self-contained file (no build step, no external deps).
Just open it in any browser.

### What it does

- Inputs for every TaskManager memory option, with default values shown.
  Highlights fields the user has explicitly set; `×` resets each one.
- Three derivation modes are supported (same as Flink):
  1. **Fine-grained** — when both `task.heap.size` and `managed.size` are set
  2. **From Total Flink Memory** — when `flink.size` is set
  3. **From Total Process Memory** — when `process.size` is set
- Displays:
  - Summary cards (Total Process, Total Flink, JVM Heap, JVM Direct)
  - Horizontal stacked-bar chart of all components
  - Vertical nested-box hierarchy diagram (mimics the `memory-model.svg`)
  - Component breakdown table (matches Flink UI's `task-manager-metrics`)
  - Generated `-Xmx`/`-Xms`/`-XX:MaxDirectMemorySize`/`-XX:MaxMetaspaceSize`
    JVM args + dynamic configs Flink would compute
- Error messages mirror the IllegalConfigurationException strings from the
  Java code (sanity checks for under/over-budget configs, out-of-range network,
  etc.).
- 5 quick presets (default 1728m, fine-grained, total-flink, large 8g, clear).

### Ported logic

JavaScript implementation in `index.html` ports these Flink classes 1:1:

| Java class | What's mirrored |
|---|---|
| `MemorySize` | parsing (`b`/`k`/`m`/`g`/`t`), `multiply`, `add`, `subtract`, `toString`, `toHumanReadableString` |
| `RangeFraction` | min/max/fraction holder, with validation |
| `ProcessMemoryUtils` | `memoryProcessSpecFromConfig`, `deriveJvmMetaspaceAndOverheadFromTotalFlinkMemory`, `deriveJvmMetaspaceAndOverheadWithTotalProcessMemory`, `deriveWithFraction`, `deriveWithInverseFraction`, all sanity checks |
| `TaskExecutorFlinkMemoryUtils` | `deriveFromRequiredFineGrainedOptions`, `deriveFromTotalFlinkMemory`, both network paths (fraction and inverse-fraction), all sanity checks |
| `TaskManagerOptions` | every memory ConfigOption + its default value (128m framework heap/off-heap, 0 task off-heap, 0.4 managed fraction, 64m network min, 0.1 network fraction, 256m metaspace, 192m/1g overhead min/max, 0.1 overhead fraction) |

### Precision

Java uses `BigDecimal` × `long` for `MemorySize.multiply(double)` then
truncates to long. The JS port uses `BigInt` throughout, with the float
fraction converted to an exact `numerator/denominator` ratio via its
`String(f)` shortest-round-trip representation — matching
`BigDecimal.valueOf(double)` semantics exactly. Both languages use IEEE 754
doubles internally, so `0.1/(1-0.1)` yields the same `0.11111111111111112`
string in either platform, and the resulting BigInt math reproduces the
exact truncated long value Flink produces.

### Verification

`verify.js` runs 9 reference scenarios in Node.js and asserts byte-exact
output against hand-computed expected values:

1. **Default (1728m process)** — produces 128/384 (FH/TH), 128/0/128
   (FO/TO/Net), 512 Managed, 256/192 (Metaspace/Overhead). All 12 assertions
   pass.
2. **1536m process** — matches the values from
   `TaskExecutorProcessUtilsTest` (TOTAL_PROCESS_MEM_SIZE).
3. **Total Flink 1280m** — same breakdown as #1 (since 1280m flink + 256m
   metaspace + 192m overhead = 1728m process).
4. **Fine-grained (task+managed)** — derives network via inverse-fraction
   (`0.1/0.9 ≈ 0.111…`), producing exactly 119304647 bytes — matches Java's
   BigDecimal computation.
5. **All three set (flink+task+managed)** — verifies network is the leftover.
6. **Nothing set** — throws the Flink error message verbatim.
7. **Total process too small** — throws Flink's "Sum of configured JVM
   Metaspace and JVM Overhead exceed configured Total Process Memory" error.
8. **Process vs derived mismatch** — throws Flink's "Configured and Derived
   memory sizes do not add up" error.
9. **Network bounds cap** — network capped to configured min.

Run with `node verify.js`. Output: `Overall: ALL PASS ✓`.

## Files

- `index.html` — the calculator (open directly in browser)
- `verify.js` — Node.js test script
- `SUMMARY.md` — this file
