import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const local = {};
try {
  for (const line of readFileSync(path.resolve(".env"), "utf8").split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    local[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const nextBin = path.resolve("node_modules", "next", "dist", "bin", "next");
const child = spawn(
  process.execPath,
  ["--use-env-proxy", nextBin, ...process.argv.slice(2)],
  {
    env: { ...process.env, ...local },
    stdio: "inherit",
    windowsHide: true,
  },
);

child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
