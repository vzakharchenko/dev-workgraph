// SPDX-FileCopyrightText: 2025-2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

interface JsonScanState {
  inString: boolean;
  isEscaped: boolean;
}

/** Updates scan state for one character inside a JSON object substring scan. */
function consumeJsonScanChar(
  ch: string,
  state: JsonScanState,
): { state: JsonScanState; depthDelta: number } {
  if (state.inString) {
    if (state.isEscaped) return { state: { inString: true, isEscaped: false }, depthDelta: 0 };
    if (ch === "\\") return { state: { inString: true, isEscaped: true }, depthDelta: 0 };
    if (ch === '"') return { state: { inString: false, isEscaped: false }, depthDelta: 0 };
    return { state, depthDelta: 0 };
  }
  if (ch === '"') return { state: { inString: true, isEscaped: false }, depthDelta: 0 };
  if (ch === "{") return { state, depthDelta: 1 };
  if (ch === "}") return { state, depthDelta: -1 };
  return { state, depthDelta: 0 };
}

/**
 * Finds the end offset of a balanced `{…}` object in `candidate` starting at `start`.
 * @returns Exclusive end index, or null when the object is unclosed.
 */
function scanJsonObjectEnd(candidate: string, start: number): number | null {
  let depth = 0;
  let state: JsonScanState = { inString: false, isEscaped: false };
  for (let i = start; i < candidate.length; i += 1) {
    const step = consumeJsonScanChar(candidate[i] ?? "", state);
    state = step.state;
    depth += step.depthDelta;
    if (depth === 0 && step.depthDelta < 0) return i + 1;
  }
  return null;
}

/**
 * Extracts the body of the first markdown JSON code fence, if present.
 */
const FENCE_OPEN_RE = /^```(?:json)?\s*/i;

function extractFencedJsonBlock(content: string): string | null {
  const fenceMarker = content.indexOf("```");
  if (fenceMarker === -1) return null;
  const openMatch = FENCE_OPEN_RE.exec(content.slice(fenceMarker));
  if (!openMatch) return null;
  const bodyStart = fenceMarker + openMatch[0].length;
  const closeMarker = content.indexOf("```", bodyStart);
  if (closeMarker === -1) return null;
  return content.slice(bodyStart, closeMarker).trim();
}

/**
 * Extracts a JSON object substring from model text (handles fences and prose).
 * @param content - Raw model message content.
 */
function extractJsonObject(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error("empty model content");
  }

  const fenced = extractFencedJsonBlock(trimmed);
  const candidate = (fenced ?? trimmed).trim();

  const start = candidate.indexOf("{");
  if (start === -1) {
    throw new Error(`no JSON object in model content: ${content.slice(0, 200)}`);
  }

  const end = scanJsonObjectEnd(candidate, start);
  if (end === null) {
    throw new Error(`unclosed JSON object in model content: ${content.slice(0, 200)}`);
  }
  return candidate.slice(start, end);
}

/**
 * Parses model content as JSON (object). Throws when content is not valid JSON.
 * @param content - Raw model message content.
 */
function parseModelJson(content: string): unknown {
  const jsonText = extractJsonObject(content);
  try {
    return JSON.parse(jsonText);
  } catch (err) {
    throw new Error(
      `invalid JSON from model: ${(err as Error).message}; snippet: ${jsonText.slice(0, 200)}`,
    );
  }
}

function assertRequiredFields(
  obj: Record<string, unknown>,
  required: string[],
  path: string,
): void {
  for (const key of required) {
    if (!(key in obj)) {
      throw new Error(`missing required field ${path}.${key}`);
    }
  }
}

function assertObjectProperties(
  obj: Record<string, unknown>,
  props: Record<string, Record<string, unknown>>,
  path: string,
): void {
  for (const [key, subSchema] of Object.entries(props)) {
    if (key in obj) {
      assertMatchesSchema(obj[key], subSchema, `${path}.${key}`);
    }
  }
}

function assertObjectSchema(value: unknown, schema: Record<string, unknown>, path: string): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`expected object at ${path}`);
  }
  const obj = value as Record<string, unknown>;
  assertRequiredFields(obj, (schema.required as string[] | undefined) ?? [], path);
  assertObjectProperties(
    obj,
    (schema.properties as Record<string, Record<string, unknown>> | undefined) ?? {},
    path,
  );
}

function assertArraySchema(value: unknown, schema: Record<string, unknown>, path: string): void {
  if (!Array.isArray(value)) {
    throw new TypeError(`expected array at ${path}`);
  }
  const items = schema.items as Record<string, unknown> | undefined;
  if (!items) return;
  for (let i = 0; i < value.length; i += 1) {
    assertMatchesSchema(value[i], items, `${path}[${i}]`);
  }
}

function assertStringSchema(value: unknown, schema: Record<string, unknown>, path: string): void {
  if (typeof value !== "string") {
    throw new TypeError(`expected string at ${path}`);
  }
  const allowed = schema.enum as unknown[] | undefined;
  if (allowed && !allowed.includes(value)) {
    throw new Error(`invalid enum at ${path}: ${JSON.stringify(value)}`);
  }
}

function assertBooleanSchema(value: unknown, path: string): void {
  if (typeof value !== "boolean") {
    throw new TypeError(`expected boolean at ${path}`);
  }
}

/**
 * Validates a parsed value against the JSON Schema subset used by Ollama `format`.
 * Throws when the value does not conform.
 */
function assertMatchesSchema(value: unknown, schema: Record<string, unknown>, path = "root"): void {
  const type = schema.type as string | undefined;
  if (type === "object") {
    assertObjectSchema(value, schema, path);
    return;
  }
  if (type === "array") {
    assertArraySchema(value, schema, path);
    return;
  }
  if (type === "string") {
    assertStringSchema(value, schema, path);
    return;
  }
  if (type === "boolean") {
    assertBooleanSchema(value, path);
  }
}

/**
 * Parses and schema-validates model JSON content.
 * @param content - Raw model message content.
 * @param schema - JSON Schema passed to Ollama `format`.
 */
export function parseAndValidateModelJson(
  content: string,
  schema: Record<string, unknown>,
): unknown {
  const parsed = parseModelJson(content);
  assertMatchesSchema(parsed, schema);
  return parsed;
}
