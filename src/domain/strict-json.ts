/** Parse JSON without ambiguous duplicate keys; never include input in errors. */
export function parseStrictJson(text: string): unknown {
  const stack: Array<{ keys?: Set<string>; expectKey: boolean }> = [];
  let keysSeen = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      const start = index;
      index += 1;
      while (index < text.length && text[index] !== '"') {
        if (text[index] === "\\") index += 1;
        index += 1;
      }
      if (index >= text.length) throw new Error("invalid JSON");
      const frame = stack.at(-1);
      if (frame?.keys && frame.expectKey) {
        const token = text.slice(start, index + 1);
        if (token.length > 6146 || ++keysSeen > 100_000) throw new Error("JSON key budget exceeded");
        const key = JSON.parse(token) as string;
        if (key.length > 1024 || frame.keys.has(key)) throw new Error("ambiguous JSON key");
        frame.keys.add(key); frame.expectKey = false;
      }
    } else if (char === "{" || char === "[") {
      if (stack.length >= 64) throw new Error("JSON depth limit exceeded");
      stack.push({ ...(char === "{" ? { keys: new Set<string>() } : {}), expectKey: char === "{" });
    } else if (char === "}" || char === "]") stack.pop();
    else if (char === "," && stack.at(-1)?.keys) stack.at(-1)!.expectKey = true;
  }
  return JSON.parse(text) as unknown;
}
