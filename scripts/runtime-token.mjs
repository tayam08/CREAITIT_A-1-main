import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const runtimeTokenPath = resolve(projectRoot, ".runtime", "app-server-token");

export async function ensureRuntimeToken({ refresh = false } = {}) {
  await mkdir(dirname(runtimeTokenPath), { recursive: true });

  if (!refresh) {
    try {
      const currentToken = (await readFile(runtimeTokenPath, "utf8")).trim();
      if (currentToken.length >= 32) return currentToken;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  const token = randomBytes(48).toString("base64url");
  await writeFile(runtimeTokenPath, `${token}\n`, { encoding: "utf8", mode: 0o600 });
  return token;
}
