const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PUBLIC_DIR = path.resolve(__dirname, "../../public");
const MANIFEST_PATH = path.join(PUBLIC_DIR, "images", "site.webmanifest");
const INDEX_HTML = path.join(PUBLIC_DIR, "index.html");

function readManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
}

test("webmanifest is linked from index.html with a relative path", () => {
  const html = fs.readFileSync(INDEX_HTML, "utf8");
  const match = /<link[^>]+rel="manifest"[^>]+href="([^"]+)"/.exec(html);
  assert.ok(match, "index.html must link a web app manifest");
  assert.equal(
    match[1],
    "images/site.webmanifest",
    "the manifest href must be relative so it works under the GitHub Pages subpath",
  );
});

test("webmanifest declares a non-empty name and short_name", () => {
  const manifest = readManifest();
  assert.equal(typeof manifest.name, "string");
  assert.ok(manifest.name.length > 0, "name must not be empty");
  assert.equal(typeof manifest.short_name, "string");
  assert.ok(manifest.short_name.length > 0, "short_name must not be empty");
});

test("webmanifest icon sources resolve from the manifest's own directory", () => {
  const manifest = readManifest();
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0);

  const manifestDir = path.dirname(MANIFEST_PATH);
  for (const icon of manifest.icons) {
    assert.ok(
      !icon.src.startsWith("/"),
      `icon src "${icon.src}" must be relative; a root-absolute path 404s under the GitHub Pages subpath`,
    );
    const resolved = path.resolve(manifestDir, icon.src);
    assert.ok(
      fs.existsSync(resolved),
      `icon "${icon.src}" must exist at ${resolved}`,
    );
    assert.match(icon.sizes, /^\d+x\d+$/);
    assert.equal(icon.type, "image/png");
  }
});

test("webmanifest start_url stays inside scope", () => {
  const manifest = readManifest();
  assert.equal(typeof manifest.start_url, "string");
  assert.ok(manifest.start_url.length > 0, "start_url must not be empty");

  const scope = manifest.scope || "./";
  const scopeUrl = new URL(scope, "https://example.com/images/");
  const startUrl = new URL(manifest.start_url, "https://example.com/images/");
  assert.equal(
    startUrl.pathname.startsWith(scopeUrl.pathname),
    true,
    `start_url (${startUrl.pathname}) must be within scope (${scopeUrl.pathname})`,
  );
  assert.equal(
    scopeUrl.pathname.endsWith("/"),
    true,
    "scope must end with a trailing slash",
  );
});

test("every relative asset referenced by index.html exists", () => {
  const html = fs.readFileSync(INDEX_HTML, "utf8");
  const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((ref) => !/^(?:https?:|#|mailto:|data:)/.test(ref));

  assert.ok(refs.length > 0, "expected at least one local asset reference");

  for (const ref of refs) {
    const resolved = path.resolve(PUBLIC_DIR, ref.replace(/^\//, ""));
    assert.ok(
      fs.existsSync(resolved),
      `index.html references "${ref}" but it does not exist at ${resolved}`,
    );
  }
});
