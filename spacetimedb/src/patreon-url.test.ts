import { afterEach, expect, it, vi } from "vitest";
import { encodePatreonForm, patreonCallbackParams, validPatreonRedirect } from "./patreon-url";
afterEach(() => vi.unstubAllGlobals());
it("encodes OAuth forms and reads callbacks without browser URL globals", () => {
  vi.stubGlobal("URL", undefined); vi.stubGlobal("URLSearchParams", undefined);
  const values = { code: "a+b &=?/c", state: "abc", secret: "'!()~*" };
  const encoded = encodePatreonForm(values);
  expect(encoded).toBe("code=a%2Bb+%26%3D%3F%2Fc&state=abc&secret=%27%21%28%29%7E*");
  expect(Object.fromEntries(patreonCallbackParams(`/callback?${encoded}`))).toEqual(values);
  expect(patreonCallbackParams("/callback?state=a&state=b").size).toBe(0);
  expect(patreonCallbackParams("/callback?code=%XX").size).toBe(0);
});
it("accepts only the exact HTTPS database callback format", () => {
  const uri = "https://maincloud.spacetimedb.com/v1/database/wildwood-coop/route/patreon/callback";
  expect(validPatreonRedirect(uri)).toBe(true);
  for (const bad of [uri+"?x=1",uri+"#x",uri.replace("https:","http:"),uri.replace(".com/",".com.evil/"),uri.replace("wildwood-coop","../other")]) expect(validPatreonRedirect(bad)).toBe(false);
});
