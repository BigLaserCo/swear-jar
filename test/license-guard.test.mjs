import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { checkLicense } from "../scripts/ci/license-guard.mjs";

const MIT_TEXT = `MIT License

Copyright (c) 2026 Big Laser Co.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED.`;

function fixture({ license = "MIT", text = MIT_TEXT } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "swear-license-"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ license }));
  if (text !== null) fs.writeFileSync(path.join(root, "LICENSE"), text);
  return root;
}

test("the real public repo has an auditable MIT license", () => {
  const result = checkLicense(path.resolve(new URL("../", import.meta.url).pathname));
  assert.equal(result.ok, true, result.errors.join("\n"));
});

test("license guard rejects a non-MIT package declaration", () => {
  const result = checkLicense(fixture({ license: "UNLICENSED" }));
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /package\.json.*MIT/i);
});

test("license guard rejects a missing or incomplete LICENSE file", () => {
  const missing = checkLicense(fixture({ text: null }));
  assert.equal(missing.ok, false);
  assert.match(missing.errors.join("\n"), /LICENSE.*missing/i);

  const incomplete = checkLicense(fixture({ text: "MIT License" }));
  assert.equal(incomplete.ok, false);
  assert.match(incomplete.errors.join("\n"), /permission grant|warranty disclaimer/i);
});
