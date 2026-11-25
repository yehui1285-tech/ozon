import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "ozon-crlf-build-"));
const copy = (name) => fs.cpSync(path.join(root, name), path.join(fixture, name), {
  recursive: true,
  filter: source => !source.includes(`${path.sep}.git${path.sep}`) && !source.includes(`${path.sep}node_modules${path.sep}`),
});
try {
  for (const name of ["tools", "web-src", "shared", "ozon-erp-collector-extension", "ozon-feishu-sync", "feishu.html"]) copy(name);
  // Simulate core.autocrlf=true checkout for the source inputs and generated HTML.
  const convert = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) convert(file);
      else if (/\.(html|js|css|json|txt)$/.test(entry.name)) {
        const text = fs.readFileSync(file, "utf8").replace(/\r?\n/g, "\r\n");
        fs.writeFileSync(file, text, "utf8");
      }
    }
  };
  for (const directory of ["web-src", "shared", "ozon-erp-collector-extension", "ozon-feishu-sync"]) convert(path.join(fixture, directory));
  for (const name of ["feishu.html"]) {
    const file = path.join(fixture, name);
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/\r?\n/g, "\r\n"), "utf8");
  }

  const run = (...args) => execFileSync(process.execPath, args, { cwd: fixture, stdio: "pipe" });
  run("tools/build-web.mjs", "--check");
  const generatedPage = path.join(fixture, "feishu.html");
  const originalPage = fs.readFileSync(generatedPage, "utf8");
  fs.writeFileSync(generatedPage, `<!-- drift -->${originalPage}`, "utf8");
  assert.throws(() => run("tools/build-web.mjs", "--check"), "content drift must still fail the generated-page check");
  fs.writeFileSync(generatedPage, originalPage, "utf8");
  // The normal build must also repair mixed checkout endings so the two
  // published HTML artifacts remain byte-identical for release verification.
  const secondPage=path.join(fixture,'ozon-feishu-sync/site/index.html');
  fs.writeFileSync(secondPage,fs.readFileSync(secondPage,'utf8').replace(/\r\n/g,'\n'),'utf8');
  run('tools/build-web.mjs');
  assert.equal(fs.readFileSync(generatedPage,'utf8'),fs.readFileSync(secondPage,'utf8'));
  assert.doesNotMatch(fs.readFileSync(generatedPage,'utf8'),/\r\n/);
  run("tools/sync-freight-rules.mjs", "--check");
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "ozon-standalone-eol-"));
  try {
    run("tools/build-standalone.mjs", output);
    assert.ok(fs.existsSync(path.join(output, "pricing.html")));
    assert.ok(fs.existsSync(path.join(output, "manifest.json")));
  } finally {
    fs.rmSync(output, { recursive: true, force: true });
  }
  console.log("CRLF checkout build checks passed");
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
