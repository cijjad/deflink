// Minimal in-memory stand-in for next/headers so services can run under Vitest.
const store = new Map<string, string>();
export async function cookies() {
  return {
    get: (name: string) => (store.has(name) ? { name, value: store.get(name)! } : undefined),
    set: (name: string, value: string) => void store.set(name, value),
    delete: (name: string) => void store.delete(name),
  };
}
export async function headers() {
  return new Headers();
}
export function __resetCookies() {
  store.clear();
}
