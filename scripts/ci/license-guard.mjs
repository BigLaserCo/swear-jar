#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function checkLicense(root = ROOT) {
  const errors = [];
  const packagePath = path.join(root, "package.json");
  const licensePath = path.join(root, "LICENSE");

  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  } catch {
    errors.push("package.json is missing or invalid");
  }
  if (pkg && pkg.license !== "MIT") {
    errors.push('package.json license must be exactly "MIT"');
  }

  let license = "";
  try {
    license = fs.readFileSync(licensePath, "utf8");
  } catch {
    errors.push("LICENSE is missing");
  }
  if (license) {
    if (!/^MIT License\s*$/m.test(license)) errors.push("LICENSE is not labeled MIT License");
    if (!/Copyright \(c\) \d{4} Big Laser Co\./.test(license)) {
      errors.push("LICENSE is missing the Big Laser Co. copyright notice");
    }
    if (!/Permission is hereby granted, free of charge/.test(license)) {
      errors.push("LICENSE is missing the MIT permission grant");
    }
    if (!/THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND/.test(license)) {
      errors.push("LICENSE is missing the MIT warranty disclaimer");
    }
  }

  return { ok: errors.length === 0, errors };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkLicense();
  if (result.ok) {
    console.log("license-guard: MIT declaration and license text verified");
  } else {
    for (const error of result.errors) console.error(`license-guard: ${error}`);
    process.exitCode = 1;
  }
}
