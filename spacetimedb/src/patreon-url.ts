// SpacetimeDB's JS runtime does not provide browser URL globals.
export const validPatreonRedirect = (uri: string) => /^https:\/\/maincloud\.spacetimedb\.com\/v1\/database\/[a-zA-Z0-9_-]+\/route\/patreon\/callback$/.test(uri);

export function encodePatreonForm(values: Record<string, string>): string {
  const encode = (value: string) => encodeURIComponent(value).replace(/[!'()~]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`).replace(/%20/g, "+");
  return Object.entries(values).map(([key, value]) => `${encode(key)}=${encode(value)}`).join("&");
}

export function patreonCallbackParams(uri: string): Map<string, string> {
  const result = new Map<string, string>();
  const query = uri.split("#", 1)[0].split("?").slice(1).join("?");
  for (const pair of query.split("&")) {
    const separator = pair.indexOf("=");
    const key = separator < 0 ? pair : pair.slice(0, separator);
    const value = separator < 0 ? "" : pair.slice(separator + 1);
    try {
      const decode = (text: string) => decodeURIComponent(text.replace(/\+/g, " "));
      const decodedKey = decode(key);
      if (result.has(decodedKey)) return new Map(); // Ambiguous OAuth responses fail closed.
      result.set(decodedKey, decode(value));
    } catch { return new Map(); }
  }
  return result;
}
