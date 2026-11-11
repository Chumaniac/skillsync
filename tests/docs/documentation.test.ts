import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("community installation documentation", () => {
  it("ships complete instructions, explicit boundaries and a portable launch profile", async () => {
    const readme = await readFile("README.md", "utf8");
    expect(readme).toContain("https://github.com/Chumaniac/skillsync-app.git");
    expect(readme).toContain("npm ci");
    expect(readme).toContain("npm run build");
    expect(readme).toContain("只读检查");
    expect(readme).toContain("未启用");
    for (const file of ["user-guide", "privacy", "build", "troubleshooting", "verification", "references"]) {
      expect((await readFile(`docs/${file}.md`, "utf8")).length).toBeGreaterThan(50);
    }
    const portable = await readFile("desktop/portable.json", "utf8");
    expect(portable).toContain("{{RESOURCES}}/runtime/bin/node");
    expect(portable).not.toContain("{{REPO}}");
    expect(portable).not.toContain("/Users/");
  });
});
