import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (!args.length || args.includes("--help")) {
  console.log(
    'node scripts/install.mjs "ST 폴더" [--update]\n화면 확장만 설치합니다. 서버 플러그인은 설치하지 않습니다.',
  );
  process.exit(0);
}
const root = path.resolve(args[0]),
  pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
if (pkg.name?.toLowerCase() !== "sillytavern")
  throw new Error("SillyTavern의 package.json이 있는 폴더를 지정해 주세요.");
const [major, minor, patch] = String(pkg.version).split(".").map((part) => Number.parseInt(part, 10) || 0);
if (major < 1 || (major === 1 && (minor < 12 || (minor === 12 && patch < 14))))
  throw new Error("ST 1.12.14 이상이 필요합니다.");
const destination = path.join(
  root,
  "public/scripts/extensions/third-party/SceneVoice",
);
const exists = async (p) => {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
};
if ((await exists(destination)) && !args.includes("--update"))
  throw new Error(
    "이미 설치되어 있습니다. --update를 붙이면 백업 후 갱신합니다.",
  );
const stage = await fs.mkdtemp(path.join(root, ".scenevoice-install-"));
const backup = path.join(
  root,
  "scenevoice-install-backups",
  new Date().toISOString().replace(/[:.]/g, "-"),
  "extension",
);
let moved = false,
  installed = false;
try {
  for (const file of [
    "client",
    "shared",
    "index.js",
    "style.css",
    "manifest.json",
    "LICENSE",
  ])
    await fs.cp(path.join(source, file), path.join(stage, file), {
      recursive: true,
    });
  await fs.mkdir(path.dirname(destination), { recursive: true });
  if (await exists(destination)) {
    await fs.mkdir(path.dirname(backup), { recursive: true });
    await fs.rename(destination, backup);
    moved = true;
  }
  await fs.rename(stage, destination);
  installed = true;
  console.log(
    `SceneVoice 설치 완료: ${destination}\nST 화면을 새로고침하세요. Fish는 config.yaml의 enableCorsProxy: true가 필요합니다. 다른 설정이나 플러그인은 변경하지 않았습니다.${moved ? "\n이전 확장 백업: " + backup : ""}`,
  );
} catch (error) {
  if (installed) await fs.rm(destination, { recursive: true, force: true });
  if (moved) await fs.rename(backup, destination);
  throw error;
} finally {
  await fs.rm(stage, { recursive: true, force: true });
}
