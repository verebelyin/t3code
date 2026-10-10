import { TextGenerationError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as TextGeneration from "../../textGeneration/TextGeneration.ts";

const unavailable = (operation: string) =>
  new TextGenerationError({
    operation,
    detail:
      "Command Code text generation is unavailable: the installed ACP CLI does not expose a tool-free mode. Command Code plan mode can still allow native file tools before the mode switch; use another provider for commit, branch, title, or change request generation.",
  });

/**
 * The ACP server creates the native harness before T3 can switch it to plan
 * mode. The published CLI permits file tools in that mode, so these helpers
 * stay unavailable until ACP exposes an explicit tool-free session.
 */
export const makeCommandCodeTextGeneration = (): Effect.Effect<
  TextGeneration.TextGeneration["Service"]
> => {
  const fail = (operation: string) => Effect.fail(unavailable(operation));
  return Effect.succeed({
    generateCommitMessage: () => fail("generateCommitMessage"),
    generatePrContent: () => fail("generatePrContent"),
    generateBranchName: () => fail("generateBranchName"),
    generateThreadTitle: () => fail("generateThreadTitle"),
  });
};
