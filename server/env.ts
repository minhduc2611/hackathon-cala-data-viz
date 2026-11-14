import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Earlier file wins: loadEnvFile never overrides a variable that is already set.
for (const file of [join(ROOT, ".env"), join(ROOT, "..", "cala-data", ".env")]) {
  if (existsSync(file)) process.loadEnvFile(file);
}
