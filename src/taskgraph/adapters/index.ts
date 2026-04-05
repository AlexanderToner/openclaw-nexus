/**
 * BrowserInterface adapters barrel.
 */
export { MockBrowserInterface } from "../browser-interface.js";
export type {
  BrowserInterface,
  VisualContext,
  StabilityStatus,
  PlaywrightAdapterOptions,
  StabilityOptions,
  IFrameOptions,
} from "../browser-interface.js";
// PlaywrightAdapter: implementation lives in playwright-adapter.ts
export { PlaywrightAdapter } from "./playwright-adapter.js";
