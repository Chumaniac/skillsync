import { createRequire } from "node:module";

// package.json is shipped with the installed CLI; source and dist share this root.
const metadata = createRequire(import.meta.url)("../package.json") as { version: string };
export const VERSION = metadata.version;
