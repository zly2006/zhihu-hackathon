// 加载 .env（不打印任何值），仅返回需要的键。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function loadEnv() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const file = path.join(root, ".env");
  const env = {};
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const index = trimmed.indexOf("=");
      const key = trimmed.slice(0, index).trim();
      let value = trimmed.slice(index + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      env[key] = value;
    }
  }
  return env;
}
