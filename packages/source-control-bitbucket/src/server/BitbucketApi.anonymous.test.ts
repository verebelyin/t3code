import { assert, it, vi } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

import * as SourceControlRateLimit from "@t3tools/source-control-core/server/SourceControlRateLimit";
import * as TestSourceControlHost from "@t3tools/source-control-testing/TestSourceControlHost";

import * as BitbucketApi from "./BitbucketApi.ts";

function makeLayer(env: Record<string, string>) {
  const execute = vi.fn((request: HttpClientRequest.HttpClientRequest) =>
    Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        new Response("Rate limit exceeded", { status: 429, headers: { "retry-after": "60" } }),
      ),
    ),
  );
  const layer = BitbucketApi.layer.pipe(
    Layer.provide(SourceControlRateLimit.layer),
    Layer.provide(Layer.succeed(HttpClient.HttpClient, HttpClient.make(execute))),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromEnv({
          env: { T3CODE_BITBUCKET_API_BASE_URL: "https://api.test.local/2.0", ...env },
        }),
      ),
    ),
    Layer.provideMerge(TestSourceControlHost.layer({ git: {} })),
    Layer.provideMerge(NodeServices.layer),
  );
  return { execute, layer };
}

const read = Effect.gen(function* () {
  const bitbucket = yield* BitbucketApi.BitbucketApi;
  return yield* bitbucket.request({
    method: "GET",
    url: "/repositories/acme/web/pullrequests/1",
  });
}).pipe(Effect.flip);

it.effect("a 429 answered to a request with no credential starts no host-wide pause", () => {
  const { execute, layer } = makeLayer({});
  return Effect.gen(function* () {
    assert.deepInclude(yield* read, {
      _tag: "BitbucketResponseError",
      status: 429,
      anonymous: true,
    });
    // The anonymous quota is not the one a credential added afterwards is metered on.
    assert.deepInclude(yield* read, { _tag: "BitbucketResponseError", status: 429 });
    assert.strictEqual(execute.mock.calls.length, 2);
  }).pipe(Effect.provide(layer));
});

it.effect("a 429 answered to a configured credential is not marked anonymous", () => {
  const { layer } = makeLayer({
    T3CODE_BITBUCKET_EMAIL: "user@example.com",
    T3CODE_BITBUCKET_API_TOKEN: "token",
  });
  return Effect.gen(function* () {
    const error = yield* read;
    assert.strictEqual(error._tag, "BitbucketResponseError");
    assert.notProperty(error, "anonymous");
    assert.strictEqual((yield* read)._tag, "SourceControlRateLimitPausedError");
  }).pipe(Effect.provide(layer));
});
