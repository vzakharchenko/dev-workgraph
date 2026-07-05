import { beforeEach, describe, expect, it, vi } from "vitest";

const { chatJson } = vi.hoisted(() => ({
  chatJson: vi.fn(),
}));

vi.mock("../../../src/lib/ollama.js", () => ({
  chatJson,
}));

import {
  classifyPathsByFilename,
  indexPathsBySignature,
  pathSignature,
} from "../../../src/lib/path-filter.js";

describe("pathSignature", () => {
  it("uses extension when present", () => {
    expect(pathSignature("src/foo/Bar.java")).toBe(".java");
    expect(pathSignature("assets/logo.png")).toBe(".png");
    expect(pathSignature("archive.tar.gz")).toBe(".gz");
  });

  it("uses basename when there is no extension", () => {
    expect(pathSignature("Dockerfile")).toBe("Dockerfile");
    expect(pathSignature("ci/Makefile")).toBe("Makefile");
  });

  it("treats dotfiles as extensionless basenames", () => {
    expect(pathSignature(".gitignore")).toBe(".gitignore");
  });
});

describe("indexPathsBySignature", () => {
  it("groups paths by shared signature", () => {
    const map = indexPathsBySignature([
      "src/a.ts",
      "lib/b.ts",
      "assets/x.png",
      "assets/y.png",
    ]);
    expect(map.get(".ts")).toEqual(["src/a.ts", "lib/b.ts"]);
    expect(map.get(".png")).toEqual(["assets/x.png", "assets/y.png"]);
  });
});

describe("classifyPathsByFilename", () => {
  beforeEach(() => {
    chatJson.mockReset();
  });

  it("sends unique signatures to the LLM and expands matches to full paths", async () => {
    chatJson.mockResolvedValue({
      likelyBinary: [".png", "src/main.ts"],
      likelyGenerated: [".ts"],
    });

    const result = await classifyPathsByFilename({
      baseUrl: "http://127.0.0.1:11434",
      model: "test",
      paths: ["assets/logo.png", "src/auth.ts", "lib/util.ts"],
    });

    expect(chatJson).toHaveBeenCalledTimes(1);
    const call = chatJson.mock.calls[0]![0] as { user: string };
    expect(call.user).toContain("- .png");
    expect(call.user).toContain("- .ts");
    expect(call.user).not.toContain("assets/logo.png");

    expect(result.likelyBinary).toEqual(["assets/logo.png"]);
    expect(result.likelyGenerated).toEqual(["src/auth.ts", "lib/util.ts"]);
  });

  it("returns empty arrays for empty input without calling LLM", async () => {
    const result = await classifyPathsByFilename({
      baseUrl: "http://127.0.0.1:11434",
      model: "test",
      paths: [],
    });
    expect(result).toEqual({ likelyBinary: [], likelyGenerated: [] });
    expect(chatJson).not.toHaveBeenCalled();
  });
});
