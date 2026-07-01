// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import type { IgnoreFiles } from "./IgnoreFiles.js";

export class JavaIgnoreFiles implements IgnoreFiles {
  name(): string {
    return "Java";
  }

  dirs(): string[] {
    return ["target", ".gradle", "out", "bin"];
  }

  files(): string[] {
    return ["*.class", "*.jar", "*.war", "*.ear"];
  }
}
