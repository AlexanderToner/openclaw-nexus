// src/taskgraph/scrubber.ts
/**
 * Scrubber — HTML Semantic Reducer (Factory Mode)
 *
 * Phase 2a.6: Added factory mode with fromNodes() for O(n) JSON tree traversal,
 * replacing JSDOM-based HTML parsing with direct node iteration.
 *
 * Goals:
 * 1. Remove noise: scripts, styles, noscript, iframes, svg internals
 * 2. Preserve semantics: aria-*, role, id, href, placeholder, value
 * 3. Collapse whitespace
 * 4. Add coordinate anchors (data-v-id) to interactive elements
 * 5. Preserve DPI-corrected boundingBox as data-v-coords
 */

import { JSDOM } from "jsdom";

// ============================================================================
// Types
// ============================================================================

export interface ScrubOptions {
  /** Maximum output length in chars (default: 8000) */
  maxLength?: number;
}

/** Canonical type for CDP snapshot nodes. */
export interface CDPSnapshotNode {
  ref: string;
  parentRef: string | null;
  depth: number;
  tag: string;
  id?: string;
  className?: string;
  role?: string;
  name?: string;
  text?: string;
  href?: string;
  type?: string;
  value?: string;
  /** Physical pixel coordinates (DPR-corrected via window.devicePixelRatio) */
  boundingBox?: { x: number; y: number; width: number; height: number } | null;
  /**
   * Phase 2b: Identifies which frame this node came from.
   * "main" = top-level page frame.
   * A frame name string = a named iframe subframe.
   * Absent = legacy node (no frame context tracked).
   */
  frameRef?: string;
}

// ============================================================================
// Constants
// ============================================================================

const WHITELIST_ATTRS = new Set([
  "id",
  "class",
  "href",
  "src",
  "placeholder",
  "value",
  "type",
  "role",
  "name",
  "alt",
  "title",
  "aria-label",
  "aria-describedby",
  "aria-expanded",
  "aria-hidden",
  "aria-pressed",
  "aria-selected",
  "aria-current",
  "aria-disabled",
  "aria-required",
  "data-testid",
  "data-v-id",
  "data-v-coords",
  "data-frame-id",
  "data-frame-src",
  "data-frame-label",
  "for",
  "tabindex",
]);

const REMOVE_TAGS = new Set([
  "script",
  "style",
  "noscript",
  "head",
  "iframe",
  "template",
  "use",
  "defs",
  "meta",
  "link",
  "svg",
  "path",
  "circle",
  "rect",
  "line",
  "ellipse",
  "polyline",
  "polygon",
  "text",
  "g",
  "tspan",
  "clippath",
  "mask",
  "lineargradient",
  "radialgradient",
  "stop",
  "filter",
  "feoffset",
  "fegaussianblur",
  "femerge",
  "foreignobject",
  "image",
  "marker",
  "switch",
  "symbol",
]);

const INTERACTIVE_TAGS = new Set(["button", "a", "input", "select", "textarea", "label"]);

const VOID_TAGS = new Set([
  "input",
  "br",
  "hr",
  "img",
  "area",
  "base",
  "col",
  "embed",
  "keygen",
  "menuitem",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const BLOCK_TAGS = new Set([
  "html",
  "body",
  "div",
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "table",
  "tr",
  "th",
  "td",
  "thead",
  "tbody",
  "form",
  "fieldset",
  "nav",
  "header",
  "footer",
  "main",
  "section",
  "article",
  "aside",
  "details",
  "summary",
  "blockquote",
  "pre",
  "code",
]);

// ============================================================================
// Scrubber Factory
// ============================================================================

export class Scrubber {
  private nodes: CDPSnapshotNode[] = [];
  private html: string = "";
  private maxLength: number;
  private interactiveCounter = { value: 0 };

  private constructor(input: CDPSnapshotNode[] | string, maxLength: number) {
    if (Array.isArray(input)) {
      this.nodes = input;
    } else {
      this.html = input;
    }
    this.maxLength = maxLength;
  }

  static fromNodes(nodes: CDPSnapshotNode[], options?: ScrubOptions): Scrubber {
    return new Scrubber(nodes, options?.maxLength ?? 8000);
  }

  static fromHtml(html: string, options?: ScrubOptions): Scrubber {
    return new Scrubber(html, options?.maxLength ?? 8000);
  }

  /** Returns HTML string (backward-compatible, used by VisualContext.domSnapshot) */
  toHtml(): string {
    if (this.nodes.length > 0) {
      return this.serializeNodes(this.nodes);
    }
    return this.serializeHtml(this.html);
  }

  /** Returns structured node tree (used by LLM vision prompt) */
  toNodes(): CDPSnapshotNode[] {
    return this.nodes;
  }

  // -------------------------------------------------------------------------
  // fromNodes serialization path: O(n) linear tree traversal
  // -------------------------------------------------------------------------

  private serializeNodes(nodes: CDPSnapshotNode[]): string {
    const output: string[] = [];
    let accumulated = 0;

    for (const node of nodes) {
      if (accumulated >= this.maxLength) {
        output.push(`\n<!-- TRUNCATED at ${this.maxLength} chars -->`);
        break;
      }

      const isInteractive =
        INTERACTIVE_TAGS.has(node.tag) || Boolean(node.role) || Boolean(node.boundingBox);

      if (isInteractive) {
        const frameId = ++this.interactiveCounter.value;
        const bbox = node.boundingBox;
        const bboxAttr = bbox
          ? ` data-v-coords="${bbox.x},${bbox.y},${bbox.width},${bbox.height}"`
          : "";
        const content =
          `<${node.tag} data-v-id="${frameId}"${bboxAttr}` +
          (node.role ? ` role="${node.role}"` : "") +
          (node.name ? ` aria-label="${node.name}"` : "") +
          `>${node.text ?? ""}</${node.tag}>`;
        output.push(content);
        accumulated += content.length;
      } else if (node.tag === "iframe") {
        const label = node.href ?? node.name ?? "Embedded Frame";
        const frameId = ++this.interactiveCounter.value;
        const content =
          `<div data-frame-id="${frameId}" ` +
          `data-frame-label="${this.escapeAttr(label)}" role="dialog"></div>`;
        output.push(content);
        accumulated += content.length;
      } else if (node.text && BLOCK_TAGS.has(node.tag)) {
        const indent = "  ".repeat(node.depth);
        const content = `${indent}<${node.tag}>${node.text}</${node.tag}>`;
        output.push(content);
        accumulated += content.length;
      }
    }

    return output.join("\n");
  }

  // -------------------------------------------------------------------------
  // fromHtml serialization path: existing JSDOM logic (preserved)
  // -------------------------------------------------------------------------

  private serializeHtml(rawHtml: string): string {
    const processed = this.processIframesForHtml(rawHtml);
    const dom = new JSDOM(processed);
    const document = dom.window.document;
    const root = document.body ?? document.documentElement;
    this.interactiveCounter = { value: 0 };
    const output = this.serializeNodeForHtml(root, 0);
    dom.window.close();

    if (output.length > this.maxLength) {
      return output.slice(0, this.maxLength) + `\n<!-- TRUNCATED at ${this.maxLength} chars -->`;
    }
    return output;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private serializeNodeForHtml(node: any, depth: number): string {
    if (!node || !node.nodeType) {
      return "";
    }

    if (node.nodeType === 3) {
      // TEXT_NODE
      const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
      return text.length === 0 ? "" : text;
    }

    if (node.nodeType !== 1) {
      return "";
    }

    const tagName = (node.tagName ?? "").toLowerCase();

    if (tagName === "svg") {
      const ariaLabel = node.getAttribute?.("aria-label") ?? node.getAttribute?.("aria-labelledby");
      return ariaLabel ? `<svg aria-label="${ariaLabel}"></svg>` : "";
    }

    if (REMOVE_TAGS.has(tagName)) {
      return "";
    }

    const isInteractive = INTERACTIVE_TAGS.has(tagName);
    const isBlock = BLOCK_TAGS.has(tagName);

    if (isInteractive) {
      this.interactiveCounter.value++;
      node.setAttribute?.("data-v-id", String(this.interactiveCounter.value));
    }

    const attrs: string[] = [];
    if (node.attributes) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const attrList: any[] = Array.from(node.attributes);
      for (const attr of attrList) {
        const name = (attr.name ?? "").toLowerCase();
        if (WHITELIST_ATTRS.has(name) && attr.value?.trim()) {
          attrs.push(`${name}="${this.escapeAttr(attr.value)}"`);
        }
      }
    }

    const attrStr = attrs.length > 0 ? " " + attrs.join(" ") : "";
    const isVoid = VOID_TAGS.has(tagName);

    if (node.childNodes?.length === 0 && !isVoid) {
      return "";
    }

    if (isVoid) {
      return `<${tagName}${attrStr}>`;
    }

    const hasOnlyText = node.childNodes?.length === 1 && node.firstChild?.nodeType === 3;
    if (hasOnlyText) {
      const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
      if (!text) {
        return "";
      }
      return isBlock
        ? `${"  ".repeat(depth)}<${tagName}${attrStr}>${text}</${tagName}>`
        : `<${tagName}${attrStr}>${text}</${tagName}>`;
    }

    const children: string[] = [];
    if (node.childNodes) {
      for (const child of Array.from(node.childNodes)) {
        const childStr = this.serializeNodeForHtml(child, depth + 1);
        if (childStr) {
          children.push(childStr);
        }
      }
    }

    if (children.length === 0) {
      return "";
    }

    if (isBlock) {
      const blockContent = children.join("\n");
      const indentedContent = blockContent
        .split("\n")
        .map((l) => `${"  ".repeat(depth + 1)}${l}`)
        .join("\n");
      return `${"  ".repeat(depth)}<${tagName}${attrStr}>\n${indentedContent}\n${"  ".repeat(depth)}</${tagName}>`;
    }

    return `<${tagName}${attrStr}>${children.join("")}</${tagName}>`;
  }

  private processIframesForHtml(html: string): string {
    return html.replace(/<iframe([^>]*)>/gi, (_match: string, attrs: string) => {
      const srcMatch = attrs.match(/src="([^"]*)"/i);
      const titleMatch = attrs.match(/title="([^"]*)"/i);
      const src = srcMatch?.[1] ?? "";
      const title = titleMatch?.[1] ?? "";
      const label = title || this.inferIFrameLabel(src);
      return `<iframe data-frame-label="${this.escapeAttr(label)}" data-frame-src="${this.escapeAttr(src)}">`;
    });
  }

  private inferIFrameLabel(src: string): string {
    if (!src) {
      return "Embedded Frame";
    }
    try {
      const hostname = new URL(src, "http://localhost").hostname;
      const rules: Array<[RegExp, string]> = [
        [/checkout\.stripe\.com/, "Stripe Checkout"],
        [/paypal\.com/, "PayPal Checkout"],
        [/accounts\.google\.com/, "Google Sign-In"],
        [/facebook\.com/, "Facebook Login"],
        [/\.stripe\.com$/, "Payment"],
        [/cdn\.|static\.|assets\./, "Embedded Content"],
      ];
      for (const [pattern, label] of rules) {
        if (pattern.test(hostname)) {
          return label;
        }
      }
      return hostname;
    } catch {
      return "Embedded Frame";
    }
  }

  private escapeAttr(value: string): string {
    return value.replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
}

// ============================================================================
// Legacy API (backward-compatible)
// ============================================================================

/** @deprecated Use Scrubber.fromHtml() instead. */
export function scrubHtml(rawHtml: string, options?: ScrubOptions): string {
  return Scrubber.fromHtml(rawHtml, options).toHtml();
}
