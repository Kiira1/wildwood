import { readFileSync } from "node:fs";

/** Size and line-length figures that the composition-root ratchets hold down. */
export type SourceMeasure = {
  lines: number;
  linesOver160: number;
  linesOver300: number;
  bytes: number;
};

export function measureSource(url: URL): SourceMeasure {
  const source = readFileSync(url, "utf8");
  const lines = source.split(/\r?\n/);
  return {
    lines: lines.length - Number(source.endsWith("\n")),
    linesOver160: lines.filter(line => line.length > 160).length,
    linesOver300: lines.filter(line => line.length > 300).length,
    bytes: Buffer.byteLength(source, "utf8"),
  };
}
