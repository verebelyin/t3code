import { describe, expect, it } from "@effect/vitest";

import * as BitbucketApi from "./BitbucketApi.ts";
import { bitbucketProviderFailure } from "./BitbucketPullRequestProvider.ts";

const responseError = (status: number, anonymous: boolean) =>
  new BitbucketApi.BitbucketResponseError({
    operation: "request",
    status,
    responseBodyLength: 0,
    ...(anonymous ? { anonymous } : {}),
  });

describe("bitbucketProviderFailure without a credential", () => {
  it.each([401, 403, 404, 429])("reports an anonymous HTTP %i as missing credentials", (status) => {
    expect(bitbucketProviderFailure(responseError(status, true)).reason).toBe("missing-tool");
  });

  it("leaves other anonymous failures and every authenticated one as they were", () => {
    expect(bitbucketProviderFailure(responseError(500, true)).reason).toBe("failed");
    expect(bitbucketProviderFailure(responseError(404, false)).reason).toBe("not-found");
    expect(bitbucketProviderFailure(responseError(429, false)).reason).toBe("rate-limited");
  });
});
