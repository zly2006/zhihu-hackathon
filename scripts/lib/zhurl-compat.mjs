import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
import path from 'node:path';

export function zhurlAccountFile(home = process.env.HOME || os.homedir()) {
  return path.join(home, '.zhihu-plus-plus', 'account.json');
}

export function flattenAccount(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.login === 'boolean') return null;
  const accounts = Array.isArray(raw.accounts) ? raw.accounts : [];
  const active = accounts.find((account) => account?.id === raw.activeAccountId && account?.session)
    || accounts.find((account) => account?.session?.login)
    || accounts[0];
  const session = active?.session;
  if (!session || session.login !== true || !session.cookies || typeof session.cookies !== 'object') return null;
  return {
    login: true,
    ...(typeof session.userAgent === 'string' && session.userAgent ? {userAgent: session.userAgent} : {}),
    cookies: session.cookies,
  };
}

export function prepareZhurlEnv() {
  const file = zhurlAccountFile();
  if (!existsSync(file)) return {env: process.env, cleanup: () => {}};
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return {env: process.env, cleanup: () => {}};
  }
  const flat = flattenAccount(raw);
  if (!flat) return {env: process.env, cleanup: () => {}};
  const directory = mkdtempSync(path.join(os.tmpdir(), 'zhurl-home-'));
  const target = path.join(directory, '.zhihu-plus-plus');
  mkdirSync(target, {recursive: true});
  writeFileSync(path.join(target, 'account.json'), JSON.stringify(flat));
  return {
    env: {...process.env, HOME: directory},
    cleanup: () => {
      try {
        rmSync(directory, {recursive: true, force: true});
      } catch {
        return;
      }
    },
  };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const binary = process.env.ZHURL_BIN || path.join(os.homedir(), '.cargo', 'bin', 'zhurl.exe');
  const compat = prepareZhurlEnv();
  try {
    const result = spawnSync(binary, process.argv.slice(2), {stdio: 'inherit', env: compat.env});
    process.exitCode = result.status ?? 1;
  } finally {
    compat.cleanup();
  }
}
