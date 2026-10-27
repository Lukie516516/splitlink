/**
 * Bun test setup — polyfills for browser globals not available in Bun runtime.
 */

// Polyfill import.meta.env for modules that use Vite env vars at module init time.
// These are read at build time in production; in tests we set safe defaults.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _meta = import.meta as any as Record<string, unknown>;
if (typeof _meta["env"] === "undefined") {
  _meta["env"] = {};
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const env = _meta["env"] as any as Record<string, unknown>;
env["DEV"] = false;
env["VITE_SPLITLINK_ADDRESS"] = "";
env["VITE_SPLITLINK_DEPLOY_BLOCK"] = "";
env["VITE_SPLITLINK_EXPECTED_BYTECODE_HASH"] = "";

// Polyfill localStorage for journal tests if needed (journal uses localStorage
// but our test module only imports the pure functions via journal-testexports).
if (typeof globalThis.localStorage === "undefined") {
  const _store: Record<string, string> = {};
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (k: string) => _store[k] ?? null,
      setItem: (k: string, v: string) => {
        _store[k] = v;
      },
      removeItem: (k: string) => {
        delete _store[k];
      },
      clear: () => {
        for (const k of Object.keys(_store)) delete _store[k];
      },
    },
    writable: true,
  });
}
