// Copies the installer Tauri buries in target/release/bundle/nsis/ into
// release/, with the name it ships under. Used by `npm run pack` and by
// the release workflow, so both produce exactly the same file names.

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundleDir = join(root, "target", "release", "bundle", "nsis");
const outDir = join(root, "release");

const { version } = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"));

let installers = [];
try {
  installers = readdirSync(bundleDir).filter((f) => f.endsWith("-setup.exe"));
} catch {
  console.error(`No installer in ${bundleDir} — run \`npm run tauri build\` first.`);
  process.exit(1);
}
if (installers.length === 0) {
  console.error(`No installer in ${bundleDir} — run \`npm run tauri build\` first.`);
  process.exit(1);
}

// Newest wins, in case an older build is still lying around.
const built = installers
  .map((f) => join(bundleDir, f))
  .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];

mkdirSync(outDir, { recursive: true });
const versioned = join(outDir, `EasyIsland-Windows-${version}-setup.exe`);
const rolling = join(outDir, "EasyIsland-Windows-setup.exe");
copyFileSync(built, versioned);
copyFileSync(built, rolling);

// A release build (CI, `--config src-tauri/tauri.updater.json` with the signing
// key in TAURI_SIGNING_PRIVATE_KEY) also leaves the updater signature next to
// the installer: ship it, and the latest.json the app reads to find updates.
const sig = `${built}.sig`;
if (existsSync(sig)) {
  copyFileSync(sig, `${versioned}.sig`);
  const repo = "https://github.com/EdoardoDevelop/easyisland";
  const latest = {
    version,
    notes: process.env.RELEASE_NOTES ?? `EasyIsland ${version}`,
    pub_date: new Date().toISOString(),
    platforms: {
      "windows-x86_64": {
        signature: readFileSync(sig, "utf8").trim(),
        url: `${repo}/releases/download/v${version}/EasyIsland-Windows-${version}-setup.exe`,
      },
    },
  };
  writeFileSync(join(outDir, "latest.json"), JSON.stringify(latest, null, 2));
  console.log("\n  Signed for the updater: latest.json written.");
}

const mb = (statSync(versioned).size / 1024 / 1024).toFixed(2);
console.log(`\n  Installer ready — ${mb} MB\n`);
console.log(`  ${versioned}`);
console.log(`  ${rolling}\n`);
