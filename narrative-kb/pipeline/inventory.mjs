// 阶段 0：扫描 localdata，产出 inventory.json（格式/编码/规模/章节数/权利初判/异常标记）
// 只读本地语料，不写原文。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LOCALDATA = path.join(root, "localdata");
const OUT = path.join(root, "narrative-kb", "data", "tmp", "inventory.json");

// 权利初判规则：公版（赵树理 1970 卒）→ public_domain；网文 txt → internal_eval_only；PDF/MOBI 保护期 → discovered
function classify(file) {
  const name = path.basename(file);
  if (name.includes("赵树理")) return { rights: "public_domain", rag: true, note: "公版（作者 1970 年去世）" };
  if (name.endsWith(".txt")) return { rights: "internal_eval_only", rag: false, note: "网文，作者权利不明（z-library 渠道），内部演示用" };
  if (name.endsWith(".pdf") || name.endsWith(".mobi")) {
    const protectedNames = ["活着", "平凡的世界", "人世间", "CLANNAD", "四月是你的谎言"];
    if (protectedNames.some((word) => name.includes(word))) {
      return { rights: "discovered", rag: false, note: "版权保护期 + 非授权渠道，仅登记元数据" };
    }
    return { rights: "discovered", rag: false, note: "未确认授权，仅登记元数据" };
  }
  return { rights: "unknown", rag: false, note: "未知格式" };
}

// 编码判定（修正版）：BOM → 严格 utf-8 → gb18030 → gbk → utf-16le → 按替换率择优
function detectEncoding(raw) {
  if (raw.length === 0) return "empty";
  if (raw.slice(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) return "utf-8-sig";
  if (raw.slice(0, 2).equals(Buffer.from([0xff, 0xfe]))) return "utf-16le";
  if (raw.slice(0, 2).equals(Buffer.from([0xfe, 0xff]))) return "utf-16be";
  const candidates = ["utf-8", "gb18030", "gbk"];
  const best = { enc: "unknown", ratio: 1.0 };
  for (const enc of candidates) {
    const text = new TextDecoder(enc, { fatal: false }).decode(raw);
    // 统计 U+FFFD 与不可打印控制字符占比
    let bad = 0;
    for (const ch of text) {
      if (ch === "\uFFFD" || (ch.charCodeAt(0) < 32 && ch !== "\n" && ch !== "\r" && ch !== "\t")) bad++;
    }
    const ratio = bad / Math.max(1, text.length);
    if (ratio < best.ratio) {
      best.enc = enc;
      best.ratio = ratio;
    }
  }
  return best.ratio < 0.02 ? best.enc : "unknown";
}

function chapterMarkers(text) {
  const matches = text.match(/第\s*[一二三四五六七八九十百千万0-9０-９]+\s*[章回节部卷]/g) || [];
  return matches.length;
}

function fileSize(bytes) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.round(bytes / 1024)}KB`;
}

function main() {
  if (!fs.existsSync(LOCALDATA)) {
    console.error("localdata 不存在");
    process.exit(1);
  }
  const files = fs.readdirSync(LOCALDATA).filter((name) => !name.startsWith(".")).map((name) => path.join(LOCALDATA, name));
  const entries = [];
  for (const file of files.sort()) {
    const stat = fs.statSync(file);
    const ext = path.extname(file).slice(1).toLowerCase();
    const raw = fs.readFileSync(file);
    const rights = classify(file);
    const entry = {
      file: path.basename(file),
      ext,
      sizeBytes: stat.size,
      sizeLabel: fileSize(stat.size),
      encoding: ext === "txt" ? detectEncoding(raw) : ext.toUpperCase(),
      chapterMarkers: ext === "txt" ? chapterMarkers(raw.toString(detectEncoding(raw) === "unknown" ? "utf-8" : detectEncoding(raw))) : null,
      rights: rights.rights,
      ragAllowed: rights.rag,
      rightsNote: rights.note,
      ingestStatus: "pending",
    };
    if (ext === "mobi") entry.ingestStatus = "skipped";
    if (ext === "mobi") entry.skipReason = "图片型（漫画），无文本层";
    entries.push(entry);
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), total: entries.length, entries }, null, 2));
  const byExt = {};
  const byRights = {};
  for (const entry of entries) {
    byExt[entry.ext] = (byExt[entry.ext] || 0) + 1;
    byRights[entry.rights] = (byRights[entry.rights] || 0) + 1;
  }
  console.log(`共 ${entries.length} 个文件`);
  console.log("按格式:", JSON.stringify(byExt));
  console.log("按权利:", JSON.stringify(byRights));
  const encodingCounts = {};
  for (const entry of entries.filter((e) => e.ext === "txt")) {
    encodingCounts[entry.encoding] = (encodingCounts[entry.encoding] || 0) + 1;
  }
  console.log("编码分布:", JSON.stringify(encodingCounts));
  console.log("异常/跳过:", entries.filter((e) => e.encoding === "unknown" || e.ingestStatus === "skipped").map((e) => e.file));
  console.log("→", path.relative(root, OUT));
}

main();
