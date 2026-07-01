// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import type { IgnoreFiles } from "./IgnoreFiles.js";

export class JSIgnoreFiles implements IgnoreFiles {
  name(): string {
    return "JavaScript/Node.js";
  }

  dirs(): string[] {
    return [
      "node_modules",
      "dist",
      "dist*",
      "build",
      "build*",
      "target",
      "coverage",
      ".next",
      ".husky",
    ];
  }

  files(): string[] {
    return [
      "package-lock.json",
      "package.json",
      "yarn.lock",
      "pnpm-lock.yaml",
      "tsconfig.json",
      "tsconfig.*.json",
      ".*",
      "eslint.config*",
      "jest*",
      "vite.config*",
      "sonar*",
      "*.min.js",
      "*.map",
      "*.png",
      "*.jpg",
      "*.jpeg",
      "*.gif",
      "*.webp",
      "*.svg",
      "*.ico",
      "*.img",
      "*.d.ts",
    ];
  }
}
