// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import type { IgnoreFiles } from "./IgnoreFiles.js";

/** Disassembled / decompiled Android artifacts (apktool, baksmali, jadx smali trees). */
export class AndroidIgnoreFiles implements IgnoreFiles {
  name(): string {
    return "Android";
  }

  dirs(): string[] {
    return ["smali", "smali_classes*"];
  }

  files(): string[] {
    return ["*.smali", "*.dex"];
  }
}
