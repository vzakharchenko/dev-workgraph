// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

export { detectArtifactKind } from "./detect.js";
export { MIGRATION_STEP_KINDS } from "./providers.js";
export {
  buildMigrationContext,
  ensureArtifactMigrated,
  migrateFile,
  migrateRepo,
} from "./registry.js";
