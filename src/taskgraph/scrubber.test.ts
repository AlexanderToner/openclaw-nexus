// src/taskgraph/scrubber.test.ts
import { describe, it, expect } from "vitest";
import { Scrubber, scrubHtml, type CDPSnapshotNode } from "./scrubber.js";

describe("scrubHtml", () => {
  it("removes script tags", () => {
    const input = `<html><body><script>alert('evil')</script><p>Hello</p></body></html>`;
    const output = scrubHtml(input);
    expect(output).not.toContain("alert");
    expect(output).toContain("Hello");
  });

  it("removes style tags", () => {
    const input = `<html><head><style>.foo { color: red; }</style></head><body><p>Text</p></body></html>`;
    const output = scrubHtml(input);
    expect(output).not.toContain("color: red");
    expect(output).toContain("Text");
  });

  it("removes noscript tags", () => {
    const input = `<body><noscript>Please enable JS</noscript><button>Click me</button></body>`;
    const output = scrubHtml(input);
    expect(output).not.toContain("Please enable JS");
  });

  it("removes iframe tags", () => {
    const input = `<body><iframe src="https://evil.com"></iframe><a href="/">Home</a></body>`;
    const output = scrubHtml(input);
    expect(output).not.toContain("iframe");
    expect(output).toContain('href="/"');
  });

  it("removes SVG internal elements", () => {
    const input = `<body><svg><path d="M0 0"/><circle cx="10"/></svg><p>Content</p></body>`;
    const output = scrubHtml(input);
    expect(output).not.toContain("d=");
    expect(output).not.toContain("cx=");
    expect(output).toContain("Content");
  });

  it("preserves aria-label attribute", () => {
    const input = `<body><div aria-label="Important section"><p>Content</p></div></body>`;
    const output = scrubHtml(input);
    expect(output).toContain('aria-label="Important section"');
  });

  it("preserves role attribute", () => {
    const input = `<body><div role="button"><span>Click</span></div></body>`;
    const output = scrubHtml(input);
    expect(output).toContain('role="button"');
  });

  it("preserves id and class attributes", () => {
    const input = `<body><div id="main" class="container active"><p>Text</p></div></body>`;
    const output = scrubHtml(input);
    expect(output).toContain('id="main"');
    expect(output).toContain('class="container active"');
  });

  it("preserves href on anchor tags", () => {
    const input = `<body><a href="https://example.com">Link</a></body>`;
    const output = scrubHtml(input);
    expect(output).toContain('href="https://example.com"');
  });

  it("preserves placeholder on input", () => {
    const input = `<body><input placeholder="Search..." type="text"/></body>`;
    const output = scrubHtml(input);
    expect(output).toContain('placeholder="Search..."');
  });

  it("preserves value on input", () => {
    const input = `<body><input value="default" type="text"/></body>`;
    const output = scrubHtml(input);
    expect(output).toContain('value="default"');
  });

  it("adds data-v-id to interactive elements", () => {
    const input = `<body><button>OK</button><a href="/">Home</a><input/></body>`;
    const output = scrubHtml(input);
    expect(output).toContain('data-v-id="1"');
    expect(output).toContain('data-v-id="2"');
    expect(output).toContain('data-v-id="3"');
  });

  it("assigns v-ids in document order", () => {
    const input = `<body><input/><button>OK</button><a href="/">Link</a></body>`;
    const output = scrubHtml(input);
    const ids = [...output.matchAll(/data-v-id="(\d+)"/g)].map((m) => m[1]);
    expect(ids).toEqual(["1", "2", "3"]);
  });

  it("collapses whitespace in text content", () => {
    const input = `<body><p>Hello     World\n\n\nNew   Line</p></body>`;
    const output = scrubHtml(input);
    expect(output).toContain("Hello World");
    expect(output).toContain("New Line");
    // Text nodes should not have consecutive spaces within them
    expect(output).not.toMatch(/Hello\s{2,}World/);
    expect(output).not.toMatch(/New\s{2,}Line/);
  });

  it("indents block elements", () => {
    const input = `<body><div><p>Text</p></div></body>`;
    const output = scrubHtml(input);
    expect(output).toContain("  <p>");
  });

  it("removes head, meta, link tags", () => {
    const input = `<html><head><meta charset="utf-8"><link rel="stylesheet"/></head><body><p>Hi</p></body></html>`;
    const output = scrubHtml(input);
    expect(output).not.toContain("meta");
    expect(output).not.toContain("link rel");
    expect(output).toContain("Hi");
  });

  it("truncates output at maxLength", () => {
    const input = `<body>${"<p>X</p>".repeat(1000)}</body>`;
    const output = scrubHtml(input, { maxLength: 100 });
    expect(output.length).toBeLessThanOrEqual(100 + "<!-- TRUNCATED".length + 20);
    expect(output).toContain("TRUNCATED");
  });

  it("handles empty input", () => {
    const output = scrubHtml("");
    expect(output).toBeDefined();
    expect(output.length).toBeLessThan(100);
  });

  it("handles malformed HTML gracefully", () => {
    const input = `<body><div><p>Text<script>// unclosed<script>more</div></body>`;
    const output = scrubHtml(input);
    expect(output).toBeDefined();
    expect(output.length).toBeGreaterThan(0);
  });

  it("preserves data-testid", () => {
    const input = `<body><button data-testid="login-btn">Login</button></body>`;
    const output = scrubHtml(input);
    expect(output).toContain('data-testid="login-btn"');
  });

  it("preserves tabindex", () => {
    const input = `<body><div tabindex="0">Focusable</div></body>`;
    const output = scrubHtml(input);
    expect(output).toContain('tabindex="0"');
  });

  it("reduces a typical login page to under 15KB", () => {
    // Simulate a "real" page with lots of noise
    const script = "<script>" + "x".repeat(5000) + "</script>";
    const style = "<style>" + "y".repeat(5000) + "</style>";
    const content = `
      <body>
        <form id="login" class="auth-form">
          <div role="group" aria-label="Login form">
            <h1>Sign In</h1>
            <input type="email" placeholder="Email" aria-label="Email address" data-testid="email-input"/>
            <input type="password" placeholder="Password" aria-label="Password" data-testid="password-input"/>
            <button type="submit" data-v-id="ignored">Sign In</button>
          </div>
        </form>
      </body>
    `;
    const input = script + style + content;
    const output = scrubHtml(input);

    // Should strip the 10KB of scripts/styles
    expect(output.length).toBeLessThan(2000);
    // Should contain semantic content
    expect(output).toContain("Sign In");
    expect(output).toContain("Email");
    expect(output).toContain("Password");
    expect(output).toContain("data-testid");
    expect(output).toContain("aria-label");
    // Should NOT contain noise
    expect(output).not.toContain("x".repeat(100));
    expect(output).not.toContain("y".repeat(100));
    // Should assign its own v-ids (not the one from input)
    expect(output).toContain('data-v-id="1"');
    expect(output).not.toContain('data-v-id="ignored"');
  });
});

// ============================================================================
// Scrubber Factory Tests
// ============================================================================

describe("Scrubber factory", () => {
  const interactiveNode: CDPSnapshotNode = {
    ref: "n1",
    parentRef: null,
    depth: 0,
    tag: "button",
    id: "submit",
    role: "button",
    name: "Submit Form",
    text: "Submit",
    boundingBox: { x: 100, y: 200, width: 80, height: 40 },
  };

  const blockNode: CDPSnapshotNode = {
    ref: "n2",
    parentRef: "n1",
    depth: 1,
    tag: "div",
    text: "Hello world",
  };

  const iframeNode: CDPSnapshotNode = {
    ref: "n3",
    parentRef: "n2",
    depth: 2,
    tag: "iframe",
    name: "https://stripe.com/checkout",
  };

  describe("fromNodes", () => {
    it("assigns sequential data-v-id to interactive nodes", () => {
      const nodes = [interactiveNode, blockNode, iframeNode];
      const scrubber = Scrubber.fromNodes(nodes);
      const html = scrubber.toHtml();
      expect(html).toContain('data-v-id="1"');
      // iframe renders as data-frame-id placeholder, not data-v-id
      expect(html).toContain('data-frame-id="1"');
    });

    it("includes DPI-corrected boundingBox as data-v-coords", () => {
      const scrubber = Scrubber.fromNodes([interactiveNode]);
      const html = scrubber.toHtml();
      expect(html).toContain('data-v-coords="100,200,80,40"');
    });

    it("renders iframe as data-frame placeholder", () => {
      const scrubber = Scrubber.fromNodes([iframeNode]);
      const html = scrubber.toHtml();
      expect(html).toContain('data-frame-label="https://stripe.com/checkout"');
      expect(html).toContain('role="dialog"');
    });

    it("renders block tags with indentation", () => {
      const scrubber = Scrubber.fromNodes([blockNode]);
      const html = scrubber.toHtml();
      expect(html).toContain("<div>");
      expect(html).toContain("Hello world");
    });

    it("truncates at maxLength", () => {
      const nodes = Array.from({ length: 100 }, (_, i) => ({
        ref: `n${i}`,
        parentRef: i > 0 ? `n${i - 1}` : null,
        depth: 0,
        tag: "div",
        text: "x".repeat(200),
      }));
      const scrubber = Scrubber.fromNodes(nodes, { maxLength: 500 });
      const html = scrubber.toHtml();
      expect(html).toContain("TRUNCATED");
    });

    it("toNodes returns original nodes", () => {
      const nodes = [interactiveNode, blockNode];
      const scrubber = Scrubber.fromNodes(nodes);
      expect(scrubber.toNodes()).toEqual(nodes);
    });
  });

  describe("fromHtml (legacy)", () => {
    it("returns output with button for simple HTML", () => {
      const html = '<html><body><button id="btn">Click me</button></body></html>';
      const scrubber = Scrubber.fromHtml(html);
      const result = scrubber.toHtml();
      expect(result).toContain("button");
      expect(result).toContain("btn");
      expect(result).not.toContain("<script");
    });

    it("toNodes returns empty array for HTML input", () => {
      const scrubber = Scrubber.fromHtml("<html><body>test</body></html>");
      expect(scrubber.toNodes()).toEqual([]);
    });
  });

  describe("DPI coordinate preservation", () => {
    it("preserves boundingBox as data-v-coords", () => {
      const node: CDPSnapshotNode = {
        ref: "n1",
        parentRef: null,
        depth: 0,
        tag: "button",
        text: "OK",
        boundingBox: { x: 200, y: 400, width: 160, height: 80 },
      };
      const scrubber = Scrubber.fromNodes([node]);
      const html = scrubber.toHtml();
      expect(html).toContain('data-v-coords="200,400,160,80"');
    });
  });
});
