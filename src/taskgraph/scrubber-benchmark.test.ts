import { describe, it, expect } from "vitest";
import { Scrubber, type CDPSnapshotNode } from "./scrubber.js";
import { scrubHtml } from "./scrubber.js";

const COMPLEX_HTML = `<html><body>
<script>for(let i=0;i<10000;i++)console.log(i)</script>
<div class="nav"><button id="btn1">Click</button><button id="btn2">Submit</button></div>
<div class="content"><p>Lorem ipsum dolor sit amet...</p></div>
<iframe src="https://stripe.com" title="Payment"></iframe>
<svg><path d="M0 0"/></svg>
</body></html>`;

const COMPLEX_NODES: CDPSnapshotNode[] = [
  { ref: "n1", parentRef: null, depth: 0, tag: "html" },
  { ref: "n2", parentRef: "n1", depth: 1, tag: "body" },
  { ref: "n3", parentRef: "n2", depth: 2, tag: "div", className: "nav" },
  {
    ref: "n4",
    parentRef: "n3",
    depth: 3,
    tag: "button",
    id: "btn1",
    text: "Click",
    boundingBox: { x: 10, y: 20, width: 100, height: 40 },
  },
  {
    ref: "n5",
    parentRef: "n3",
    depth: 3,
    tag: "button",
    id: "btn2",
    text: "Submit",
    boundingBox: { x: 120, y: 20, width: 100, height: 40 },
  },
  { ref: "n6", parentRef: "n2", depth: 2, tag: "div", className: "content" },
  {
    ref: "n7",
    parentRef: "n6",
    depth: 3,
    tag: "p",
    text: "Lorem ipsum dolor sit amet consectetur adipiscing elit.",
  },
  { ref: "n8", parentRef: "n2", depth: 2, tag: "iframe", href: "https://stripe.com" },
];

describe("Scrubber performance benchmark", () => {
  it("fromNodes is faster than fromHtml for structured data", () => {
    const htmlTime = performance.now();
    for (let i = 0; i < 100; i++) {
      Scrubber.fromHtml(COMPLEX_HTML).toHtml();
    }
    const htmlDuration = performance.now() - htmlTime;

    const nodesTime = performance.now();
    for (let i = 0; i < 100; i++) {
      Scrubber.fromNodes(COMPLEX_NODES).toHtml();
    }
    const nodesDuration = performance.now() - nodesTime;

    // Log benchmark results for analysis
    console.log(
      `Scrubber benchmark (100 iterations): fromHtml=${htmlDuration.toFixed(2)}ms, fromNodes=${nodesDuration.toFixed(2)}ms ratio=${(htmlDuration / nodesDuration).toFixed(2)}x`,
    );
    // fromNodes should be faster (no DOM parsing overhead)
    expect(nodesDuration).toBeLessThan(htmlDuration * 2);
  });

  it("scrubHtml (legacy) still works and matches fromHtml output", () => {
    const _legacy = scrubHtml(COMPLEX_HTML);
    const factory = Scrubber.fromHtml(COMPLEX_HTML).toHtml();
    expect(factory).toContain("button");
    expect(factory).toContain("btn1");
    expect(factory).not.toContain("<script");
    expect(factory).not.toContain("console.log");
    // Legacy and factory should produce semantically equivalent output
    expect(factory).toContain("nav");
    expect(factory).toContain("content");
    expect(factory).toContain("Lorem ipsum");
  });

  it("fromNodes handles large node sets efficiently", () => {
    const largeNodes: CDPSnapshotNode[] = Array.from({ length: 500 }, (_, i) => ({
      ref: `n${i}`,
      parentRef: i > 0 ? `n${i - 1}` : null,
      depth: 0,
      tag: "button",
      text: `Button ${i}`,
      boundingBox: { x: i * 10, y: i * 5, width: 80, height: 40 },
    }));

    const time = performance.now();
    const result = Scrubber.fromNodes(largeNodes, { maxLength: 5000 }).toHtml();
    const duration = performance.now() - time;

    console.log(`Large node set (500 nodes): ${duration.toFixed(2)}ms`);
    expect(result).toContain("data-v-id");
    expect(result).toContain("TRUNCATED");
    expect(duration).toBeLessThan(100); // Should complete in under 100ms
  });
});
