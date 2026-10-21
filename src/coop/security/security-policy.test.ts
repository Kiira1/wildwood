import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const entryHtml = readFileSync(new URL("../../../public/index.html", import.meta.url), "utf8");

describe("browser security policy", () => {
  it("keeps the eval exception the SpacetimeDB browser SDK needs", () => {
    // The SDK builds its serializers with Function(); without this every connection fails.
    const policy = entryHtml.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)" \/>/)?.[1];
    expect(policy).toContain("script-src 'self' 'unsafe-eval'");
  });

  it("never sends the OAuth callback URL as a referrer", () => {
    expect(entryHtml).toContain('<meta name="referrer" content="no-referrer" />');
  });
});
