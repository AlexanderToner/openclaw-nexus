// src/taskgraph/browser-interface.ts
/**
 * BrowserInterface — Abstract browser contract
 *
 * Decouples the VisionVerificationHook and Scrubber from the specific driver
 * (Playwright, CDP, Puppeteer). Implement this interface to provide real
 * browser access; a MockBrowserInterface is used for testing.
 */
/**
 * Mock implementation for tests and environments without a real browser.
 * Returns synthetic data so hook logic (triggering, escalation) can be tested.
 */
export class MockBrowserInterface {
  _content;
  _screenshot;
  _url;
  _visibility;
  constructor(opts) {
    this._content = opts?.content ?? "<html><body>Mock page</body></html>";
    this._screenshot = opts?.screenshot ?? Buffer.from("mock-screenshot");
    this._url = opts?.url ?? "https://example.com";
    this._visibility = new Map(Object.entries(opts?.visibility ?? { "*": true }));
  }
  async getContent() {
    return this._content;
  }
  async getScreenshot(_options) {
    return this._screenshot;
  }
  async isVisible(selector) {
    return this._visibility.get(selector) ?? this._visibility.get("*") ?? false;
  }
  async getUrl() {
    return this._url;
  }
}
