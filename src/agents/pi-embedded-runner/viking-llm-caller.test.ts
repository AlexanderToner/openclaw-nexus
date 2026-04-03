// src/agents/pi-embedded-runner/viking-llm-caller.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { VikingConfig } from "../../config/types.agent-defaults.js";

// Create mock fetch outside the module mock
const mockFetch = vi.fn();

vi.mock("../../config/types.agent-defaults.js", () => ({
  VikingConfig: {},
}));

// Import after mock setup
import { createVikingLlmCaller } from "./viking-llm-caller.js";

function setupMockResponse(response: string) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ response }),
  });
}

function setupMockError(error: Error) {
  mockFetch.mockRejectedValueOnce(error);
}

function setupMockHttpError(status: number, statusText: string) {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    statusText,
  });
}

describe("VikingLlmCaller", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    // Ensure fetch is globally available
    global.fetch = mockFetch;
  });

  describe("createVikingLlmCaller", () => {
    it("creates a caller with default config", () => {
      const caller = createVikingLlmCaller();
      expect(caller).toBeDefined();
      expect(typeof caller).toBe("function");
    });

    it("creates a caller with custom config", () => {
      const config: VikingConfig = {
        enabled: true,
        model: {
          provider: "ollama",
          modelId: "qwen3.5:9b",
          endpoint: "http://custom-endpoint:11434",
          maxTokens: 256,
          timeoutMs: 2000,
        },
        fallbackIntent: "code",
      };
      const caller = createVikingLlmCaller(config);
      expect(caller).toBeDefined();
    });
  });

  describe("classification", () => {
    it("parses valid JSON response", async () => {
      setupMockResponse(
        JSON.stringify({
          intent: "file_ops",
          requiredTools: ["fs_read", "fs_write"],
          requiredFiles: ["config.json"],
          requiredSkills: [],
          contextSizeHint: "minimal",
          confidence: 0.9,
        }),
      );

      const caller = createVikingLlmCaller();
      const result = await caller("Read config.json");

      expect(result.intent).toBe("file_ops");
      expect(result.requiredTools).toContain("fs_read");
      expect(result.confidence).toBe(0.9);
    });

    it("handles embedded JSON in response", async () => {
      setupMockResponse(
        `Here is the classification:\n${JSON.stringify({
          intent: "browser",
          requiredTools: ["browser_navigate"],
          requiredFiles: [],
          requiredSkills: [],
          contextSizeHint: "normal",
          confidence: 0.85,
        })}\nEnd of output.`,
      );

      const caller = createVikingLlmCaller();
      const result = await caller("Navigate to example.com");

      expect(result.intent).toBe("browser");
      expect(result.requiredTools).toContain("browser_navigate");
    });

    it("normalizes invalid intent to fallback", async () => {
      setupMockResponse(
        JSON.stringify({
          intent: "invalid_intent",
          requiredTools: [],
          requiredFiles: [],
          requiredSkills: [],
          contextSizeHint: "minimal",
          confidence: 0.5,
        }),
      );

      const caller = createVikingLlmCaller({ fallbackIntent: "chat" });
      const result = await caller("Hello");

      expect(result.intent).toBe("chat");
    });

    it("normalizes invalid confidence to default", async () => {
      setupMockResponse(
        JSON.stringify({
          intent: "chat",
          requiredTools: [],
          requiredFiles: [],
          requiredSkills: [],
          contextSizeHint: "minimal",
          confidence: 2.5,
        }),
      );

      const caller = createVikingLlmCaller();
      const result = await caller("Hello");

      expect(result.confidence).toBe(0.5);
    });

    it("normalizes invalid contextSizeHint to minimal", async () => {
      setupMockResponse(
        JSON.stringify({
          intent: "chat",
          requiredTools: [],
          requiredFiles: [],
          requiredSkills: [],
          contextSizeHint: "huge",
          confidence: 0.8,
        }),
      );

      const caller = createVikingLlmCaller();
      const result = await caller("Hello");

      expect(result.contextSizeHint).toBe("minimal");
    });
  });

  describe("error handling", () => {
    it("returns fallback on fetch error", async () => {
      setupMockError(new Error("Network error"));

      const caller = createVikingLlmCaller({ fallbackIntent: "chat" });
      const result = await caller("Hello");

      expect(result.intent).toBe("chat");
      expect(result.confidence).toBe(0.3);
      expect(result.requiredTools).toEqual([]);
    });

    it("returns fallback on HTTP error", async () => {
      setupMockHttpError(500, "Internal Server Error");

      const caller = createVikingLlmCaller({ fallbackIntent: "chat" });
      const result = await caller("Hello");

      expect(result.intent).toBe("chat");
      expect(result.confidence).toBe(0.3);
    });

    it("returns fallback on invalid JSON", async () => {
      setupMockResponse("This is not JSON at all");

      const caller = createVikingLlmCaller({ fallbackIntent: "chat" });
      const result = await caller("Hello");

      expect(result.intent).toBe("chat");
      expect(result.confidence).toBe(0.3);
    });

    it("returns fallback on timeout", async () => {
      // Mock a slow response that exceeds timeout
      mockFetch.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            setTimeout(
              () =>
                resolve({
                  ok: true,
                  json: async () => ({ response: "{}" }),
                }),
              5000,
            );
          }),
      );

      const caller = createVikingLlmCaller({
        model: { timeoutMs: 100 },
        fallbackIntent: "chat",
      });
      const result = await caller("Hello");

      expect(result.intent).toBe("chat");
      expect(result.confidence).toBe(0.3);
    });
  });

  describe("all intent types", () => {
    it("parses file_ops intent", async () => {
      setupMockResponse(
        JSON.stringify({
          intent: "file_ops",
          requiredTools: ["fs_read"],
          requiredFiles: ["file.txt"],
          requiredSkills: [],
          contextSizeHint: "minimal",
          confidence: 0.95,
        }),
      );

      const caller = createVikingLlmCaller();
      const result = await caller("Read file.txt");

      expect(result.intent).toBe("file_ops");
    });

    it("parses gui_auto intent", async () => {
      setupMockResponse(
        JSON.stringify({
          intent: "gui_auto",
          requiredTools: ["gui_click", "gui_type"],
          requiredFiles: [],
          requiredSkills: [],
          contextSizeHint: "normal",
          confidence: 0.9,
        }),
      );

      const caller = createVikingLlmCaller();
      const result = await caller("Click on the button");

      expect(result.intent).toBe("gui_auto");
    });

    it("parses browser intent", async () => {
      setupMockResponse(
        JSON.stringify({
          intent: "browser",
          requiredTools: ["browser_navigate"],
          requiredFiles: [],
          requiredSkills: [],
          contextSizeHint: "normal",
          confidence: 0.85,
        }),
      );

      const caller = createVikingLlmCaller();
      const result = await caller("Open example.com");

      expect(result.intent).toBe("browser");
    });

    it("parses code intent", async () => {
      setupMockResponse(
        JSON.stringify({
          intent: "code",
          requiredTools: ["edit_file"],
          requiredFiles: ["src/main.ts"],
          requiredSkills: [],
          contextSizeHint: "full",
          confidence: 0.88,
        }),
      );

      const caller = createVikingLlmCaller();
      const result = await caller("Fix the bug in main.ts");

      expect(result.intent).toBe("code");
      expect(result.contextSizeHint).toBe("full");
    });

    it("parses chat intent", async () => {
      setupMockResponse(
        JSON.stringify({
          intent: "chat",
          requiredTools: [],
          requiredFiles: [],
          requiredSkills: [],
          contextSizeHint: "minimal",
          confidence: 0.95,
        }),
      );

      const caller = createVikingLlmCaller();
      const result = await caller("Hello there");

      expect(result.intent).toBe("chat");
      expect(result.requiredTools).toEqual([]);
    });
  });

  describe("API call format", () => {
    it("calls Ollama API with correct format", async () => {
      setupMockResponse(
        JSON.stringify({
          intent: "chat",
          requiredTools: [],
          requiredFiles: [],
          requiredSkills: [],
          contextSizeHint: "minimal",
          confidence: 0.9,
        }),
      );

      const caller = createVikingLlmCaller({
        model: {
          provider: "ollama",
          modelId: "qwen3.5:9b",
          endpoint: "http://localhost:11434",
          maxTokens: 256,
        },
      });

      await caller("Test message");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:11434/api/generate",
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        }),
      );

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body as string);
      expect(body.model).toBe("qwen3.5:9b");
      expect(body.stream).toBe(false);
      expect(body.options.num_predict).toBe(256);
    });
  });
});
