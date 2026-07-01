// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import type { IgnoreFiles } from "./ignore/IgnoreFiles.js";
import { JavaIgnoreFiles } from "./ignore/JavaIgnoreFiles.js";
import { JSIgnoreFiles } from "./ignore/JSIgnoreFiles.js";

/** Registered ignore profiles — add a language module here to extend noise filtering. */
export const ignoreFiles: IgnoreFiles[] = [new JSIgnoreFiles(), new JavaIgnoreFiles()];
