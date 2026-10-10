import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { ProviderInstanceId } from "@t3tools/contracts";

import { makeCommandCodeTextGeneration } from "./CommandCodeTextGeneration.ts";

const selection = { instanceId: ProviderInstanceId.make("commandcode-test"), model: "test-model" };
const input = {
  cwd: "/tmp",
  branch: "main",
  stagedSummary: "files changed",
  stagedPatch: "diff",
  modelSelection: selection,
};

describe("Command Code text generation", () => {
  it.effect("reports the typed unsupported capability for every operation", () =>
    Effect.gen(function* () {
      const service = yield* makeCommandCodeTextGeneration();
      const results = yield* Effect.all([
        Effect.exit(service.generateCommitMessage(input)),
        Effect.exit(
          service.generatePrContent({
            cwd: "/tmp",
            baseBranch: "main",
            headBranch: "feature",
            commitSummary: "summary",
            diffSummary: "diff",
            diffPatch: "patch",
            modelSelection: selection,
          }),
        ),
        Effect.exit(
          service.generateBranchName({ cwd: "/tmp", message: "branch", modelSelection: selection }),
        ),
        Effect.exit(
          service.generateThreadTitle({ cwd: "/tmp", message: "title", modelSelection: selection }),
        ),
      ]);
      for (const result of results) {
        expect(result._tag).toBe("Failure");
        if (result._tag === "Failure") {
          expect(result.cause.toString()).toContain("tool-free mode");
        }
      }
    }),
  );
});
