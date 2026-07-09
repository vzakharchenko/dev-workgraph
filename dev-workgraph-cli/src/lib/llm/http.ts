// SPDX-FileCopyrightText: 2026 Vasyl Zakharchenko
// SPDX-License-Identifier: Apache-2.0

import { Agent, setGlobalDispatcher } from "undici";

/** Node's fetch defaults to ~1 hour headers timeout; large local models can exceed that. */
const LLM_HEADERS_TIMEOUT_MS = 60 * 60 * 1000;
const LLM_BODY_TIMEOUT_MS = 60 * 60 * 1000;

setGlobalDispatcher(
  new Agent({
    headersTimeout: LLM_HEADERS_TIMEOUT_MS,
    bodyTimeout: LLM_BODY_TIMEOUT_MS,
  }),
);

/** Total attempts for a chat call before giving up (HTTP/parse failures are retried). */
export const MAX_CHAT_ATTEMPTS = 3;

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function stripTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === "/") end -= 1;
  return end === url.length ? url : url.slice(0, end);
}

/**
 * Normalizes a user-supplied endpoint into a scheme-qualified base URL with no
 * trailing slash. Accepts `host:port`, `http://host:port`, or undefined.
 */
export function normalizeUrl(value?: string): string | undefined {
  if (!value) return undefined;
  let url = value.trim();
  if (!url) return undefined;
  if (!/^https?:\/\//.test(url)) url = `http://${url}`;
  return stripTrailingSlashes(url);
}

export function formatFetchError(err: unknown): string {
  const error = err as Error & { cause?: { code?: string; message?: string } };
  const cause = error.cause;
  if (cause?.code) return `${error.message} [${cause.code}]`;
  return error.message;
}
