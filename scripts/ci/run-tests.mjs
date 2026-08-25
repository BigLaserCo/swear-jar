import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");

function parseVersion(version) {
  const [major = 0, minor = 0] = String(version || "").split(".").map(Number);
  return { major, minor };
}

function testArgsForVersion(version = process.versions.node) {
  const { major, minor } = parseVersion(version);
  const args = ["--test"];

  if (major > 23 || (major === 23 && minor >= 6)) {
    args.push("--test-isolation=none");
  } else if (major === 23 || (major === 22 && minor >= 8)) {
    args.push("--experimental-test-isolation=none");
  }

  if (major > 20 || (major === 20 && minor >= 10)) {
    args.push("--test-concurrency=1");
  }

  return args;
}

function runTests({ cwd = ROOT, version = process.versions.node } = {}) {
  const result = spawnSync(process.execPath, testArgsForVersion(version), {
    cwd,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runTests();
}

export { runTests, testArgsForVersion };
