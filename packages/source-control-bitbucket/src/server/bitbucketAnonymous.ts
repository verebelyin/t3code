import type { HttpClientResponse } from "effect/http";

import type { BitbucketPullRequestApiError } from "./BitbucketPullRequestApi.ts";

// Reads go out without a credential so public repositories work unconfigured. A private one
// answers those with 404 (or 401/403) and the anonymous quota is spent within a few reads, so each
// of these means "add a credential", not "not found" or "rate limited".
const ANONYMOUS_REFUSAL_STATUSES: ReadonlySet<number> = new Set([401, 403, 404, 429]);

export function anonymousMark(response: HttpClientResponse.HttpClientResponse): {
  readonly anonymous?: true;
} {
  return response.request.headers.authorization === undefined ? { anonymous: true } : {};
}

export function isAnonymousRefusal(error: BitbucketPullRequestApiError): boolean {
  return (
    (error._tag === "BitbucketResponseError" || error._tag === "BitbucketResponseBodyReadError") &&
    error.anonymous === true &&
    ANONYMOUS_REFUSAL_STATUSES.has(error.status)
  );
}
