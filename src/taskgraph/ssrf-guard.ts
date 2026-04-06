/**
 * SSRF (Server-Side Request Forgery) protection guard.
 *
 * Blocks requests to private IP ranges (10.x, 172.16-31.x, 192.168.x, 127.x, 169.254.x)
 * and cloud metadata endpoints (169.254.169.254) that could be used to exfiltrate data
 * from internal networks or cloud provider metadata services.
 */

// IP ranges that must be blocked (private/internal)
const BLOCKED_IP_PATTERNS = [
  /^127\./, // Loopback
  /^10\./, // Class A private
  /^172\.(1[6-9]|2\d|3[012])\./, // Class B private
  /^192\.168\./, // Class C private
  /^169\.254\./, // Link-local (AWS metadata!)
  /^0\./, // Current network
  /^224\./, // Multicast
  /^240\./, // Reserved
];

const BLOCKED_HOSTNAMES = [
  "metadata.google.internal",
  "metadata.googleusercontent.com",
  "169.254.169.254", // AWS/GCP/Azure metadata
  "metadata.internal",
];

export interface SSRFGuardOptions {
  /** Allow internal/private IP ranges. Default: false (blocked) */
  allowInternal?: boolean;
  /** Allow cloud metadata endpoints. Default: false (blocked) */
  allowMetadata?: boolean;
}

export class SSRFGuard {
  constructor(private opts: SSRFGuardOptions = {}) {}

  /**
   * Check if a host is blocked by SSRF protection.
   * @param host - The hostname or IP address to check
   * @returns true if the host is blocked, false if allowed
   */
  isBlocked(host: string): boolean {
    const lower = host.toLowerCase();

    // Check blocked hostnames (exact match or subdomain)
    if (BLOCKED_HOSTNAMES.some((h) => lower === h || lower.endsWith(`.${h}`))) {
      // Metadata hostname matched — apply allowMetadata override
      if (this.opts.allowMetadata) {
        return false;
      }
      return true;
    }

    // Try to parse as IP and check private ranges
    for (const pattern of BLOCKED_IP_PATTERNS) {
      if (pattern.test(host)) {
        // 169.254.x.x is a metadata IP — only exempt via allowMetadata, not allowInternal
        if (pattern.source === "^169\\\\.254\\\\." && this.opts.allowMetadata) {
          continue;
        }
        if (!this.opts.allowInternal) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Assert that a host is safe to request. Throws if blocked.
   * @param host - The hostname or IP address to check
   * @throws Error if the host is blocked
   */
  assertSafe(host: string): void {
    if (this.isBlocked(host)) {
      throw new Error(`SSRF guard blocked request to ${host}`);
    }
  }
}

/** Default guard instance with all protections enabled */
export const defaultSSRFGuard = new SSRFGuard();
