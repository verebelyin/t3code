import { describe, expect, it } from "vite-plus/test";

import { formatWorkspaceRelativePath } from "./filePathDisplay";

describe("formatWorkspaceRelativePath", () => {
  it("formats absolute workspace paths from the workspace root", () => {
    expect(
      formatWorkspaceRelativePath(
        "C:/Users/mike/dev-stuff/t3code/apps/web/src/session-logic.ts:501",
        "C:/Users/mike/dev-stuff/t3code",
      ),
    ).toBe("t3code/apps/web/src/session-logic.ts:501");
  });

  it("prefixes relative paths with the workspace root label", () => {
    expect(
      formatWorkspaceRelativePath(
        "apps/web/src/session-logic.ts:501",
        "C:/Users/mike/dev-stuff/t3code",
      ),
    ).toBe("t3code/apps/web/src/session-logic.ts:501");
  });

  it("keeps paths already rooted at the workspace label stable", () => {
    expect(
      formatWorkspaceRelativePath(
        "t3code/apps/web/src/session-logic.ts:501",
        "C:/Users/mike/dev-stuff/t3code",
      ),
    ).toBe("t3code/apps/web/src/session-logic.ts:501");
  });

  it("preserves columns when present", () => {
    expect(
      formatWorkspaceRelativePath(
        "/C:/Users/mike/dev-stuff/t3code/apps/web/src/session-logic.ts:501:9",
        "C:/Users/mike/dev-stuff/t3code",
      ),
    ).toBe("t3code/apps/web/src/session-logic.ts:501:9");
  });
});

describe("formatWorkspaceRelativePath — bare style", () => {
  const BARE = { style: "bare" } as const;

  it("drops the workspace label for an absolute path inside the workspace", () => {
    expect(
      formatWorkspaceRelativePath(
        "/Users/me/dev/t3code/apps/web/src/a.ts",
        "/Users/me/dev/t3code",
        BARE,
      ),
    ).toBe("apps/web/src/a.ts");
  });

  it("leaves an already-relative path alone", () => {
    expect(formatWorkspaceRelativePath("apps/web/src/a.ts", "/Users/me/dev/t3code", BARE)).toBe(
      "apps/web/src/a.ts",
    );
  });

  it("strips a redundant leading workspace-name segment", () => {
    expect(formatWorkspaceRelativePath("t3code/apps/web/a.ts", "/Users/me/dev/t3code", BARE)).toBe(
      "apps/web/a.ts",
    );
  });

  it("renders the workspace root itself as '.'", () => {
    expect(formatWorkspaceRelativePath("/Users/me/dev/t3code", "/Users/me/dev/t3code", BARE)).toBe(
      ".",
    );
  });

  it("handles Windows drive paths", () => {
    expect(
      formatWorkspaceRelativePath(
        "/C:/Users/mike/dev-stuff/t3code/apps/web/src/a.ts",
        "C:/Users/mike/dev-stuff/t3code",
        BARE,
      ),
    ).toBe("apps/web/src/a.ts");
  });

  it("preserves line and column suffixes", () => {
    expect(
      formatWorkspaceRelativePath(
        "/Users/me/dev/t3code/src/a.ts:12:4",
        "/Users/me/dev/t3code",
        BARE,
      ),
    ).toBe("src/a.ts:12:4");
  });

  it("leaves an absolute path outside the workspace untouched", () => {
    expect(formatWorkspaceRelativePath("/etc/hosts", "/Users/me/dev/t3code", BARE)).toBe(
      "/etc/hosts",
    );
  });

  it("leaves the path untouched when there is no workspace root", () => {
    expect(formatWorkspaceRelativePath("/Users/me/dev/t3code/src/a.ts", undefined, BARE)).toBe(
      "/Users/me/dev/t3code/src/a.ts",
    );
  });

  it("defaults to the labelled style when no options are given", () => {
    expect(
      formatWorkspaceRelativePath("/Users/me/dev/t3code/src/a.ts", "/Users/me/dev/t3code"),
    ).toBe("t3code/src/a.ts");
  });
});
