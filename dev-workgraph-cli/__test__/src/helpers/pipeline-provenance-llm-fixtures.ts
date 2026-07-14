// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

export function testLlmSlots() {
  const choice = {
    providerId: "ollama" as const,
    baseUrl: "http://127.0.0.1:11434",
    model: "test-model",
  };
  return { commit: choice, report: choice, narrative: choice };
}
