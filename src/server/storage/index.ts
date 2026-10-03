import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/server/env";

/** Object storage abstraction. Local disk for development; an S3-compatible adapter implements the same interface in production. */
export interface StorageProvider {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
}

class LocalStorage implements StorageProvider {
  constructor(private root: string) {}
  private resolve(key: string) {
    if (!/^[a-zA-Z0-9/_-]+$/.test(key) || key.includes("..")) throw new Error("Invalid storage key");
    return path.join(this.root, key);
  }
  async put(key: string, data: Buffer) {
    const file = this.resolve(key);
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(file, data, { mode: 0o600 });
  }
  async get(key: string) {
    return readFile(this.resolve(key));
  }
}

export const storage: StorageProvider = new LocalStorage(path.resolve(env.STORAGE_DIR));
