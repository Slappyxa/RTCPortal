import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, "../../..");
export const PUBLIC_JS = path.join(PROJECT_ROOT, "public/js");

let bundleCount = 0;
const bundleDirs = [];

// Repo-internal staging root so coverage is attributed to files under cwd.
// The root is created on demand and only removed by run-regression-suite.js.
const STAGING_PARENT = path.join(PROJECT_ROOT, "coverage-bundles");

export function createBundleDir() {
  const useStagingRoot = process.env.RTCPORTAL_COVERAGE === "1";

  if (useStagingRoot) {
    fs.mkdirSync(STAGING_PARENT, { recursive: true });
    const dir = fs.mkdtempSync(
      path.join(STAGING_PARENT, `bundle-${bundleCount++}-`),
    );
    bundleDirs.push(dir);
    return dir;
  }

  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), `rtcportal-bundle-${bundleCount++}-`),
  );
  bundleDirs.push(dir);
  return dir;
}

function removeBundleDirs() {
  for (const dir of bundleDirs.splice(0, bundleDirs.length)) {
    safeRemove(dir);
  }
  // The shared staging parent is owned by run-regression-suite.js. Deleting it
  // here would race with sibling modules that may still be resolving imports
  // out of it, producing ERR_MODULE_NOT_FOUND in coverage runs.
}

// On Windows a directory can stay locked briefly after the child process that
// used it exits. A leftover temp dir is harmless; throwing from an exit handler
// turns a clean run into a crash.
function safeRemove(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
  }
}

// Coverage runs keep bundles on disk until after the report is written, because
// deleting them in an exit handler makes the report come back empty.
process.on("exit", () => {
  if (process.env.RTCPORTAL_COVERAGE === "1") return;
  removeBundleDirs();
});

const REL_IMPORT_RE = /(from\s+|import\s*)(["'])(\.[^"']+\.js)(["'])/g;

export async function bundleModule(srcPath, bundleDir) {
  const entries = new Map();
  const queue = [srcPath];

  while (queue.length) {
    const current = path.resolve(queue.pop());
    if (entries.has(current)) continue;

    const rel = path.relative(PUBLIC_JS, current);
    if (rel.startsWith("..")) {
      throw new Error(`Non-frontend dependency cannot be bundled: ${current}`);
    }
    const dest = path.join(bundleDir, rel.replace(/\.js$/, ".mjs"));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    let source = fs.readFileSync(current, "utf8");

    source = source.replace(REL_IMPORT_RE, (_m, prefix, q1, spec, q2) => {
      const resolved = path.resolve(path.dirname(current), spec);
      queue.push(resolved + (resolved.endsWith(".js") ? "" : ".js"));
      return `${prefix}${q1}${spec.replace(/\.js$/, ".mjs")}${q2}`;
    });

    fs.writeFileSync(dest, source, "utf8");
    entries.set(current, dest);
  }

  const topDest = entries.get(path.resolve(srcPath));
  return import(pathToFileURL(topDest).href);
}
