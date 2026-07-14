// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import { pipelineProvenanceStep } from "./steps/v1000005-pipeline-provenance.js";
import { finishQuestionsAnalysesStep } from "./steps/v1000006-finish-questions-analyses.js";
import type { MigrationStepKind } from "./types.js";

/** Registered schema migrations — add a new {@link MigrationStepKind} here. */
export const MIGRATION_STEP_KINDS: readonly MigrationStepKind[] = [
  pipelineProvenanceStep,
  finishQuestionsAnalysesStep,
].sort((a, b) => a.toVersion - b.toVersion);
