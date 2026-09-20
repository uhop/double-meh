// nano-bench's runner is portable except for one import; in a browser `performance` is a global.
// Each page maps `node:perf_hooks` here, so nothing inside nano-bench changes.
export const performance = globalThis.performance;
export default {performance};
