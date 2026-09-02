import { ensureRuntimeToken, runtimeTokenPath } from "./runtime-token.mjs";

await ensureRuntimeToken({ refresh: true });
console.log(`Prepared local-only authentication at ${runtimeTokenPath}`);
