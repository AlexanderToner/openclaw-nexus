import { describe, it, expect } from "vitest";
import {
  NavigationDuringCaptureError,
  parseNodesFromEvaluateResult,
} from "./cdp-atomic-snapshot.js";

describe("parseNodesFromEvaluateResult", () => {
  it("parses valid evaluate result into nodes", () => {
    const result = {
      result: {
        value: {
          nodes: [
            { ref: "n1", parentRef: null, depth: 0, tag: "html" },
            { ref: "n2", parentRef: "n1", depth: 1, tag: "body" },
          ],
        },
      },
    };
    const nodes = parseNodesFromEvaluateResult(result);
    expect(nodes).toHaveLength(2);
    expect(nodes[0].ref).toBe("n1");
  });

  it("returns empty array on invalid result", () => {
    expect(parseNodesFromEvaluateResult({})).toEqual([]);
    expect(parseNodesFromEvaluateResult({ result: {} })).toEqual([]);
    expect(parseNodesFromEvaluateResult({ result: { value: null } })).toEqual([]);
  });
});

describe("NavigationDuringCaptureError", () => {
  it("includes phase and timestamp", () => {
    const ts = 1743844800000;
    const err = new NavigationDuringCaptureError(ts, "screenshot");
    expect(err.message).toContain("screenshot");
    expect(err.capturedAt).toBe(ts);
    expect(err.phase).toBe("screenshot");
  });
});
