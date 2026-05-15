# Flink TaskManager Memory Calculator

A single-file, zero-dependency web calculator for Apache Flink TaskManager memory configuration.

**Live page:** <http://robertmetzger.de/flink-memory-calculator/>

Edit any TaskManager memory configuration parameter (`taskmanager.memory.*`) and see the resulting
effective memory sizes (Total Process Memory, Total Flink Memory, Framework/Task Heap, Network,
Managed, Metaspace, Overhead), computed with the same logic Flink's Java code uses.

## Features

- Inputs for every TaskManager memory option with defaults shown; explicitly-set fields are highlighted.
- All three derivation modes Flink supports:
  1. **Fine-grained** — when both `task.heap.size` and `managed.size` are set
  2. **From Total Flink Memory** — when `flink.size` is set
  3. **From Total Process Memory** — when `process.size` is set
- Summary cards, horizontal stacked-bar chart, vertical nested-box hierarchy, component breakdown
  table, and generated JVM arguments (`-Xmx`/`-Xms`/`-XX:MaxDirectMemorySize`/`-XX:MaxMetaspaceSize`).
- Error messages mirror the `IllegalConfigurationException` strings from the Flink Java code.
- Five quick presets (default 1728m, fine-grained, total-flink, large 8g, clear).

## Files

- [`index.html`](index.html) — the calculator (open directly in a browser, no build step).
- [`verify.js`](verify.js) — Node.js test script. Asserts byte-exact output against 9 hand-computed
  reference scenarios. Run with `node verify.js`.

## Implementation notes

The JavaScript in `index.html` ports the following Flink classes 1:1:

| Java class | What's mirrored |
|---|---|
| `MemorySize` | parsing (`b`/`k`/`m`/`g`/`t`), `multiply`, `add`, `subtract`, `toString`, `toHumanReadableString` |
| `RangeFraction` | min/max/fraction holder, with validation |
| `ProcessMemoryUtils` | `memoryProcessSpecFromConfig`, `deriveJvmMetaspaceAndOverheadFromTotalFlinkMemory`, `deriveJvmMetaspaceAndOverheadWithTotalProcessMemory`, `deriveWithFraction`, `deriveWithInverseFraction`, sanity checks |
| `TaskExecutorFlinkMemoryUtils` | `deriveFromRequiredFineGrainedOptions`, `deriveFromTotalFlinkMemory`, both network paths, sanity checks |
| `TaskManagerOptions` | every memory `ConfigOption` + its default value |

Java uses `BigDecimal × long` for `MemorySize.multiply(double)` then truncates to long. The JS port
uses `BigInt` throughout, with the float fraction converted to an exact `numerator/denominator` ratio
via `String(f)` shortest-round-trip representation — matching `BigDecimal.valueOf(double)` semantics
byte-exactly.

## Credits

Built with [Claude Code](https://claude.com/claude-code) using the **Claude Opus 4.7 (1M context)** model.
