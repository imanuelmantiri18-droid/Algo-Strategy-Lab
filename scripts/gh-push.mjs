/**
 * Push changed workspace files to GitHub using the Contents API.
 * Runs via: node scripts/gh-push.mjs
 * Requires: GITHUB_TOKEN env var
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TOKEN = process.env.GITHUB_TOKEN;
const OWNER = "imanuelmantiri18-droid";
const REPO = "Algo-Strategy-Lab";
const BRANCH = "main";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (!TOKEN) { console.error("❌ GITHUB_TOKEN not set"); process.exit(1); }

const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  "Content-Type": "application/json",
  "User-Agent": "Replit-Agent",
  Accept: "application/vnd.github+json",
};

async function ghGet(url) {
  const r = await fetch(url, { headers: HEADERS });
  if (!r.ok) throw new Error(`GET ${url} → ${r.status} ${await r.text()}`);
  return r.json();
}

async function getFileSha(filePath) {
  try {
    const d = await ghGet(`${API}/contents/${filePath}?ref=${BRANCH}`);
    return d.sha;
  } catch {
    return null; // file doesn't exist yet on GitHub
  }
}

async function pushFile(repoPath, localPath) {
  const content = fs.readFileSync(localPath, "utf8");
  const encoded = Buffer.from(content).toString("base64");
  const sha = await getFileSha(repoPath);

  const body = {
    message: `fix: sync ${repoPath} from Replit`,
    content: encoded,
    branch: BRANCH,
    ...(sha ? { sha } : {}),
  };

  const r = await fetch(`${API}/contents/${repoPath}`, {
    method: "PUT",
    headers: HEADERS,
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    const t = await r.text();
    throw new Error(`PUT ${repoPath} → ${r.status} ${t}`);
  }
  const d = await r.json();
  console.log(`  ✅ ${repoPath}  (${d.commit?.sha?.slice(0, 7)})`);
}

// Files to push: [repoPath, localAbsPath]
const FILES = [
  ["artifacts/api-server/src/scripts/live-bot.ts",
   `${ROOT}/artifacts/api-server/src/scripts/live-bot.ts`],
  ["artifacts/api-server/src/scripts/telegram-bot.ts",
   `${ROOT}/artifacts/api-server/src/scripts/telegram-bot.ts`],
  ["artifacts/api-server/src/routes/bot.ts",
   `${ROOT}/artifacts/api-server/src/routes/bot.ts`],
  ["artifacts/api-server/package.json",
   `${ROOT}/artifacts/api-server/package.json`],
  ["scripts/gh-push.mjs",
   `${ROOT}/scripts/gh-push.mjs`],
  ["scripts/push-to-github.sh",
   `${ROOT}/scripts/push-to-github.sh`],
  ["scripts/deploy-railway.sh",
   `${ROOT}/scripts/deploy-railway.sh`],
  ["package.json",
   `${ROOT}/package.json`],
  ["pnpm-workspace.yaml",
   `${ROOT}/pnpm-workspace.yaml`],
  ["pnpm-lock.yaml",
   `${ROOT}/pnpm-lock.yaml`],
];

console.log(`\n🚀 Pushing ${FILES.length} files to github.com/${OWNER}/${REPO} (${BRANCH})\n`);

let ok = 0, fail = 0;
for (const [repoPath, localPath] of FILES) {
  try {
    process.stdout.write(`  pushing ${repoPath}… `);
    await pushFile(repoPath, localPath);
    ok++;
  } catch (e) {
    console.log(`\n  ❌ ${repoPath}: ${e.message}`);
    fail++;
  }
}

console.log(`\n${ok} pushed, ${fail} failed.`);
if (fail > 0) process.exit(1);
console.log(`\n✅ Done! Railway will auto-deploy if GitHub is connected.\n`);
