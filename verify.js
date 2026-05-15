// Standalone Node.js verification of the memory calc logic.
// Extracts the core logic from index.html and runs reference scenarios.

const fs = require('fs');
const html = fs.readFileSync(__dirname + '/index.html', 'utf-8');
// Extract everything between <script> tags
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('No <script> block found'); process.exit(1); }
let code = m[1];
// Strip DOM-touching bits — keep only constants, MemorySize math, derivation funcs.
// Replace `document` and `PRESETS` references with no-ops so the file evaluates.
// Strip initialization calls at the end — we'll invoke computeSpec ourselves.
code = code.replace(/\/\/ Initial render[\s\S]*$/, '');
// Replace `document` with a stub that supports forEach.
code = `
  const stubEl = { innerHTML: '', textContent: '', value: '', classList: { toggle: () => {}, remove: () => {} }, addEventListener: () => {}, querySelectorAll: () => [] };
  const document = {
    getElementById: () => stubEl,
    querySelectorAll: () => [],
  };
` + code;

// Evaluate the JS module in this Node context so we can call computeSpec().
const ctx = {};
const vm = require('vm');
vm.createContext(ctx);
vm.runInContext(code + '\nthis.computeSpec = computeSpec; this.userConfig = userConfig; this.humanReadable = humanReadable; this.compactString = compactString; this.OPTIONS = OPTIONS;', ctx);

const MIB = 1024n * 1024n;

function mib(n) { return BigInt(n) * MIB; }

function reset() {
  for (const o of ctx.OPTIONS) ctx.userConfig[o.key] = '';
}

function setCfg(values) {
  reset();
  for (const [k, v] of Object.entries(values)) {
    ctx.userConfig[k] = v;
  }
}

function assertEq(actual, expected, msg) {
  const ok = actual === expected;
  console.log(`  ${ok ? '✓' : '✗'} ${msg}: expected ${expected}, got ${actual}`);
  return ok;
}

let allPass = true;

console.log('\n--- Scenario 1: Default (Total Process Memory = 1728m) ---');
setCfg({ 'taskmanager.memory.process.size': '1728m' });
const s1 = ctx.computeSpec();
allPass &= assertEq(s1.totalProcess, mib(1728), 'Total Process');
allPass &= assertEq(s1.flinkMemory.totalFlink, mib(1280), 'Total Flink');
allPass &= assertEq(s1.flinkMemory.frameworkHeap, mib(128), 'Framework Heap');
allPass &= assertEq(s1.flinkMemory.taskHeap, mib(384), 'Task Heap');
allPass &= assertEq(s1.flinkMemory.frameworkOffHeap, mib(128), 'Framework Off-Heap');
allPass &= assertEq(s1.flinkMemory.taskOffHeap, 0n, 'Task Off-Heap');
allPass &= assertEq(s1.flinkMemory.network, mib(128), 'Network');
allPass &= assertEq(s1.flinkMemory.managed, mib(512), 'Managed');
allPass &= assertEq(s1.metaspace, mib(256), 'Metaspace');
allPass &= assertEq(s1.overhead, mib(192), 'Overhead');
allPass &= assertEq(s1.flinkMemory.jvmHeap, mib(512), 'JVM Heap (fh+th)');
allPass &= assertEq(s1.flinkMemory.jvmDirect, mib(256), 'JVM Direct (fo+to+net)');

console.log('\n--- Scenario 2: Total Process Memory = 1536m (matches Flink test TOTAL_PROCESS_MEM_SIZE) ---');
setCfg({ 'taskmanager.memory.process.size': '1536m' });
const s2 = ctx.computeSpec();
allPass &= assertEq(s2.totalProcess, mib(1536), 'Total Process');
// 1536m - 256m metaspace - 192m overhead (min, since 1536*0.1=153.6m < 192m) = 1088m flink
allPass &= assertEq(s2.flinkMemory.totalFlink, mib(1088), 'Total Flink');
allPass &= assertEq(s2.overhead, mib(192), 'Overhead (capped to min)');
// 0.4 * 1088m = 435.2m managed → 456340275.2 → truncated... wait, 0.4 is exact.
// Actually let's compute: 1088 * 1024 * 1024 = 1140850688 bytes
// 1140850688 * 0.4 = 456340275.2 → BigDecimal.longValue = 456340275
// That's not an exact multiple of MiB. Let me just check.
console.log('    Managed bytes:', s2.flinkMemory.managed);
// 1088m * 0.1 = 108.8m = 114085068.8 → 114085068 bytes (truncated, less than 64m? no, 64m = 67108864, > 114085068? no 114085068 > 67108864)
console.log('    Network bytes:', s2.flinkMemory.network);
console.log('    Task heap bytes:', s2.flinkMemory.taskHeap);

console.log('\n--- Scenario 3: Total Flink Memory = 1280m, no other config ---');
setCfg({ 'taskmanager.memory.flink.size': '1280m' });
const s3 = ctx.computeSpec();
allPass &= assertEq(s3.flinkMemory.totalFlink, mib(1280), 'Total Flink');
allPass &= assertEq(s3.flinkMemory.frameworkHeap, mib(128), 'Framework Heap');
allPass &= assertEq(s3.flinkMemory.frameworkOffHeap, mib(128), 'Framework Off-Heap');
allPass &= assertEq(s3.flinkMemory.managed, mib(512), 'Managed (0.4 of 1280m)');
allPass &= assertEq(s3.flinkMemory.network, mib(128), 'Network (0.1 of 1280m)');
allPass &= assertEq(s3.flinkMemory.taskHeap, mib(384), 'Task Heap (derived remainder)');
// Process: 1280m + 256m metaspace + overhead. Overhead = inverse-fraction.
// base = 1280m + 256m = 1536m. f/(1-f) = 0.1/0.9 = 0.11111...
// 1536m * 0.111... = 170.666...m = 178956970.66... → trunc 178956970 bytes
// min 192m = 201326592, max 1g = 1073741824. relative < min, so use min.
allPass &= assertEq(s3.overhead, mib(192), 'Overhead (capped to min)');
allPass &= assertEq(s3.metaspace, mib(256), 'Metaspace');
allPass &= assertEq(s3.totalProcess, mib(1280) + mib(256) + mib(192), 'Total Process derived');

console.log('\n--- Scenario 4: Fine-grained (task.heap + managed) ---');
setCfg({
  'taskmanager.memory.task.heap.size': '512m',
  'taskmanager.memory.managed.size': '256m',
});
const s4 = ctx.computeSpec();
allPass &= assertEq(s4.flinkMemory.taskHeap, mib(512), 'Task Heap');
allPass &= assertEq(s4.flinkMemory.managed, mib(256), 'Managed');
// flink excl network = 128 + 128 + 512 + 0 + 256 = 1024m
// network derived via inverse-fraction: ratio = 0.1/0.9 ≈ 0.11111
// 1024m * 0.11111... = ~113.78m ≈ 119304647 bytes
// min 64m = 67108864, max LONG_MAX. relative > min, ok.
// Total Flink = 1024m + ~113.78m ≈ 1137.78m
console.log('    Network bytes:', s4.flinkMemory.network);
console.log('    Total Flink bytes:', s4.flinkMemory.totalFlink);
console.log('    Total Process bytes:', s4.totalProcess);

console.log('\n--- Scenario 5: Total Flink + task.heap + managed (all set) ---');
setCfg({
  'taskmanager.memory.flink.size': '1280m',
  'taskmanager.memory.task.heap.size': '100m',
  'taskmanager.memory.managed.size': '200m',
});
const s5 = ctx.computeSpec();
allPass &= assertEq(s5.flinkMemory.totalFlink, mib(1280), 'Total Flink (configured)');
allPass &= assertEq(s5.flinkMemory.taskHeap, mib(100), 'Task Heap (configured)');
allPass &= assertEq(s5.flinkMemory.managed, mib(200), 'Managed (configured)');
// flink excl network = 128 + 128 + 100 + 0 + 200 = 556m
// network = 1280m - 556m = 724m
allPass &= assertEq(s5.flinkMemory.network, mib(724), 'Network (derived = TotalFlink − rest)');

console.log('\n--- Scenario 6: Invalid configuration (nothing set) ---');
setCfg({});
try {
  ctx.computeSpec();
  console.log('  ✗ Expected error, got success');
  allPass = false;
} catch (e) {
  console.log('  ✓ Throws expected error:', e.message.slice(0, 80) + '...');
}

console.log('\n--- Scenario 7: TotalProcess too small (< metaspace + overhead) ---');
setCfg({ 'taskmanager.memory.process.size': '300m' });
try {
  const s7 = ctx.computeSpec();
  console.log('  ✗ Expected error, got:', ctx.humanReadable(s7.totalProcess));
  allPass = false;
} catch (e) {
  console.log('  ✓ Throws expected error:', e.message.slice(0, 80) + '...');
}

console.log('\n--- Scenario 8: TotalProcess vs derived sum mismatch (task+managed+flink set) ---');
// derive Total Flink, add metaspace+overhead — but configured Total Process disagrees.
setCfg({
  'taskmanager.memory.flink.size': '1280m',
  'taskmanager.memory.task.heap.size': '100m',
  'taskmanager.memory.managed.size': '200m',
  'taskmanager.memory.process.size': '999m',  // wrong on purpose
});
try {
  ctx.computeSpec();
  console.log('  ✗ Expected mismatch error, got success');
  allPass = false;
} catch (e) {
  console.log('  ✓ Throws expected error:', e.message.slice(0, 80) + '...');
}

console.log('\n--- Scenario 9: Network bounds — small min/max forces derived value out of range ---');
// Total Process = 4g. Set network.min=900m, network.max=1000m, total.flink to make derived network outside.
// total flink ≈ 4g - 256m - 0.1*4g(capped to 1g but 1g>0.4g so overhead=409.6m...
// Actually let's just confirm the bounds error fires.
setCfg({
  'taskmanager.memory.flink.size': '4g',
  'taskmanager.memory.network.min': '900m',
  'taskmanager.memory.network.max': '1000m',
});
// 4g flink: managed = 1.6g, network derived by fraction = 0.1*4g = 409.6m, but min 900m → capped to 900m.
// flink-excl-task-heap = 128 + 128 + 0 + 1638.4 + 900 = ... taskHeap = 4096 - that
// network would be capped to 900m, then we check excl-task-heap < total flink
// Actually this might just work without error.
try {
  const s9 = ctx.computeSpec();
  console.log('  → network bytes:', s9.flinkMemory.network, '(', ctx.compactString(s9.flinkMemory.network), ')');
  console.log('  → task heap bytes:', s9.flinkMemory.taskHeap, '(', ctx.compactString(s9.flinkMemory.taskHeap), ')');
} catch (e) {
  console.log('  → error:', e.message.slice(0, 120));
}

console.log('\nOverall:', allPass ? 'ALL PASS ✓' : 'SOME FAILURES ✗');
process.exit(allPass ? 0 : 1);
