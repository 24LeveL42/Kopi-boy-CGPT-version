import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The owner's final Terms of Use and Privacy Policy, kept word for word in
 * src/content/legal. Edit those .md files to change the text; the pages
 * are built from them.
 */
export type LegalDoc = "terms" | "privacy";

export function readLegalDoc(doc: LegalDoc): string {
  return readFileSync(path.join(process.cwd(), "src", "content", "legal", `${doc}.md`), "utf8");
}
