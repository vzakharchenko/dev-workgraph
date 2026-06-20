import { beforeAll, describe, expect, it, vi } from "vitest";

describe("cli", () => {
  let program: typeof import("../src/cli.js").program;

  beforeAll(async () => {
    vi.spyOn(process, "exit").mockImplementation((() => undefined) as typeof process.exit);
    process.argv = ["node", "dev-workgraph"];
    ({ program } = await import("../src/cli.js"));
  });

  it("registers pipeline commands", () => {
    const names = program.commands.map((c) => c.name());
    for (const cmd of [
      "check",
      "init",
      "authors",
      "evidence",
      "summarize",
      "commit-group",
      "report",
      "prepare",
      "final",
      "run",
      "export",
      "import",
    ]) {
      expect(names).toContain(cmd);
    }
  });
});
