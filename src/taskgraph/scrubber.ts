// src/taskgraph/scrubber.ts
/**
 * Scrubber — HTML Semantic Reducer
 *
 * Transforms raw HTML from Playwright into a minimal, LLM-readable format.
 *
 * Goals:
 * 1. Remove noise: scripts, styles, noscript, iframes, svg internals
 * 2. Preserve semantics: aria-*, role, id, href, placeholder, value
 * 3. Collapse whitespace
 * 4. Add coordinate anchors (data-v-id) to interactive elements
 *
 * Input:  5000+ lines of raw Playwright HTML (200KB+)
 * Output: ~100 lines of semantic skeleton (~5-15KB)
 */

import { JSDOM } from "jsdom";

export interface ScrubOptions {
  /** Maximum output length in chars (default: 8000) */
  maxLength?: number;
}

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
  // SVG child elements — JSDOM parses them as HTML elements (no namespace),
  // so they need explicit removal. The root <svg> tag itself is handled by
  // the separate SVG check above (which preserves it if it has aria-label).
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

// HTML void elements — self-closing, always render regardless of children
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

/**
 * Scrub raw HTML into a minimal semantic skeleton.
 */
export function scrubHtml(rawHtml: string, options?: ScrubOptions): string {
  const maxLength = options?.maxLength ?? 8000;

  const dom = new JSDOM(rawHtml);
  const document = dom.window.document;
  const interactiveCounter = { value: 0 };

  const root = document.body ?? document.documentElement;
  const output = serializeNode(root, interactiveCounter, 0);

  dom.window.close();

  if (output.length > maxLength) {
    return output.slice(0, maxLength) + `\n<!-- TRUNCATED at ${maxLength} chars -->`;
  }

  return output;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serializeNode(node: any, counter: { value: number }, depth: number): string {
  if (node.nodeType === 3) {
    // TEXT_NODE
    const text = node.textContent ?? "";
    const trimmed = text.replace(/\s+/g, " ").trim();
    if (trimmed.length === 0) {
      return "";
    }
    return trimmed;
  }

  if (node.nodeType !== 1) {
    return "";
  } // ELEMENT_NODE

  const el = node as Element;
  const tagName = el.tagName?.toLowerCase() ?? "";

  // For SVG, only preserve if it has meaningful aria (check before REMOVE_TAGS,
  // since we want to keep SVG elements with aria-label)
  if (tagName === "svg") {
    const ariaLabel = el.getAttribute("aria-label") ?? el.getAttribute("aria-labelledby");
    if (ariaLabel) {
      return `<svg aria-label="${ariaLabel}"></svg>`;
    }
    return "";
  }

  // Remove noise tags entirely
  if (REMOVE_TAGS.has(tagName)) {
    return "";
  }

  const isInteractive = INTERACTIVE_TAGS.has(tagName);
  const isBlock = BLOCK_TAGS.has(tagName);

  // Assign coordinate anchor to interactive elements
  if (isInteractive) {
    counter.value++;
    el.setAttribute("data-v-id", String(counter.value));
  }

  // Collect whitelisted attributes
  const attrs: string[] = [];
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    if (WHITELIST_ATTRS.has(name) && attr.value.trim().length > 0) {
      attrs.push(`${name}="${escapeAttr(attr.value)}"`);
    }
  }

  const attrStr = attrs.length > 0 ? " " + attrs.join(" ") : "";

  // Leaf nodes: single-line (void elements render even when empty)
  const isVoid = VOID_TAGS.has(tagName);
  if (el.childNodes.length === 0 && !isVoid) {
    return "";
  }

  // Render void elements (e.g. <input/>) with their attributes
  if (isVoid) {
    return `<${tagName}${attrStr}>`;
  }

  const hasOnlyText = el.childNodes.length === 1 && el.firstChild?.nodeType === 3;
  if (hasOnlyText) {
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text.length === 0) {
      return "";
    }
    return isBlock
      ? `${indent(depth)}<${tagName}${attrStr}>${text}</${tagName}>`
      : `<${tagName}${attrStr}>${text}</${tagName}>`;
  }

  // Serialize children
  const children: string[] = [];
  for (const child of Array.from(el.childNodes)) {
    const childStr = serializeNode(child, counter, depth + 1);
    if (childStr.length > 0) {
      children.push(childStr);
    }
  }

  if (children.length === 0) {
    return "";
  }

  if (isBlock) {
    const blockContent = children.join("\n");
    const indentedContent = blockContent
      .split("\n")
      .map((l) => `${indent(depth + 1)}${l}`)
      .join("\n");
    return `${indent(depth)}<${tagName}${attrStr}>\n${indentedContent}\n${indent(depth)}</${tagName}>`;
  }

  return `<${tagName}${attrStr}>${children.join("")}</${tagName}>`;
}

function indent(depth: number): string {
  return "  ".repeat(depth);
}

function escapeAttr(value: string): string {
  return value.replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
