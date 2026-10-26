// Sets RUN_LIVE_TESTS=1 and hands off to vitest, so live network tests run
// on every platform (Windows cmd.exe does not support `VAR=1 cmd` syntax).
// Live tests are disabled by default; this script is only used by
// `npm run test:live`.
process.env.RUN_LIVE_TESTS = '1';
const { startVitest } = await import('vitest/node');
const ctx = await startVitest('test', [], { watch: false, run: true });
if (ctx === undefined) {
  console.error('Failed to start vitest.');
  process.exit(1);
}
await ctx.close();
process.exitCode = ctx.state.getCountOfFailedTests() > 0 ? 1 : 0;
