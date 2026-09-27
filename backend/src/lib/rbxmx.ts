// Rewrites the scripts inside a Roblox .rbxmx model.
//
// .rbxmx is XML; every Script/LocalScript/ModuleScript carries its code in
//   <ProtectedString name="Source">…</ProtectedString>
// either as a CDATA section or XML-escaped text. We pull each source out,
// swap the key marker for the user's key, run it through the obfuscator and
// write it back as CDATA. No XML parser is needed (or available) for that:
// the element is distinctive enough for a regular expression, and everything
// outside it is copied through untouched.

const SOURCE_RE = /(<ProtectedString name="Source">)([\s\S]*?)(<\/ProtectedString>)/g;
const CDATA_RE = /<!\[CDATA\[([\s\S]*?)\]\]>/g;

export function isRbxmx(xml: string): boolean {
  return /<roblox[\s>]/.test(xml.slice(0, 2000));
}

// The text of a ProtectedString element as Roblox wrote it → Luau source.
function decodeSource(raw: string): string {
  if (raw.includes("<![CDATA[")) {
    // Roblox splits sources containing "]]>" into consecutive CDATA runs.
    return Array.from(raw.matchAll(CDATA_RE), (m) => m[1]).join("");
  }
  return raw
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, "&");
}

function encodeSource(source: string): string {
  return `<![CDATA[${source.replace(/\]\]>/g, "]]]]><![CDATA[>")}]]>`;
}

export function countMarkedScripts(xml: string, marker: string): number {
  let hits = 0;
  for (const match of xml.matchAll(SOURCE_RE)) {
    if (decodeSource(match[2]).includes(marker)) hits++;
  }
  return hits;
}

export interface TransformOptions {
  marker: string;
  key: string;
  // "marked": only scripts that contain the marker are obfuscated;
  // "all": every script in the model is.
  scope: "marked" | "all";
  // null skips obfuscation (mode "none").
  obfuscate: ((source: string) => Promise<string>) | null;
}

export interface TransformResult {
  xml: string;
  scripts: number;
  replaced: number;
  obfuscated: number;
}

// Substitutes the key and obfuscates; scripts are processed sequentially so
// the obfuscator is not hammered in parallel.
export async function transformRbxmx(xml: string, options: TransformOptions): Promise<TransformResult> {
  const result: TransformResult = { xml: "", scripts: 0, replaced: 0, obfuscated: 0 };
  const pieces: string[] = [];
  let last = 0;

  for (const match of xml.matchAll(SOURCE_RE)) {
    const [whole, open, raw, close] = match;
    const start = match.index ?? 0;
    pieces.push(xml.slice(last, start));
    last = start + whole.length;
    result.scripts++;

    let source = decodeSource(raw);
    const marked = source.includes(options.marker);
    if (marked) {
      source = source.split(options.marker).join(options.key);
      result.replaced++;
    }
    if (options.obfuscate !== null && (marked || options.scope === "all")) {
      source = await options.obfuscate(source);
      result.obfuscated++;
    }
    pieces.push(open, marked || options.scope === "all" ? encodeSource(source) : raw, close);
  }
  pieces.push(xml.slice(last));
  result.xml = pieces.join("");
  return result;
}
