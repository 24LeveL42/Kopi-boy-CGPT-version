import Link from "next/link";
import type { ReactNode } from "react";

/**
 * A deliberately tiny Markdown renderer for the owner's Terms and Privacy
 * text (src/content/legal). It only turns syntax into markup: "# " and "## "
 * headings, "- " bullets, **bold** and [text](href) links. Every word is
 * passed through as written. Lines that follow each other without a blank
 * line stay on separate lines (<br/>), so a contact block reads as written.
 */

type Block =
  | { kind: "h1" | "h2"; text: string }
  | { kind: "p"; lines: string[] }
  | { kind: "ul"; items: string[] };

export function parseLegalMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  let current: Block | null = null;
  const flush = () => {
    if (current) blocks.push(current);
    current = null;
  };

  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") {
      flush();
    } else if (line.startsWith("## ")) {
      flush();
      blocks.push({ kind: "h2", text: line.slice(3) });
    } else if (line.startsWith("# ")) {
      flush();
      blocks.push({ kind: "h1", text: line.slice(2) });
    } else if (line.startsWith("- ")) {
      if (current?.kind !== "ul") {
        flush();
        current = { kind: "ul", items: [] };
      }
      current.items.push(line.slice(2));
    } else {
      if (current?.kind !== "p") {
        flush();
        current = { kind: "p", lines: [] };
      }
      current.lines.push(line);
    }
  }
  flush();
  return blocks;
}

const INLINE = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const key = `${keyPrefix}-${n++}`;
    if (m[1] !== undefined) {
      out.push(
        <strong key={key} className="font-extrabold text-slate-900">
          {renderInline(m[1], key)}
        </strong>,
      );
    } else {
      const href = m[3];
      const cls = "font-bold text-[#6d22e8] underline underline-offset-2";
      out.push(
        href.startsWith("/") ? (
          <Link key={key} href={href} className={cls}>
            {m[2]}
          </Link>
        ) : (
          <a key={key} href={href} className={cls} rel="noopener noreferrer">
            {m[2]}
          </a>
        ),
      );
    }
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function LegalMarkdown({ source }: { source: string }) {
  return (
    <>
      {parseLegalMarkdown(source).map((block, i) => {
        const key = `b${i}`;
        switch (block.kind) {
          case "h1":
            return (
              <h1 key={key} className="text-[29px] font-black leading-tight tracking-tight text-[#171521]">
                {renderInline(block.text, key)}
              </h1>
            );
          case "h2":
            return (
              <h2 key={key} className="mt-6 text-base font-extrabold leading-6 text-slate-900">
                {renderInline(block.text, key)}
              </h2>
            );
          case "ul":
            return (
              <ul key={key} className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-6 text-slate-600">
                {block.items.map((item, j) => (
                  <li key={j}>{renderInline(item, `${key}-${j}`)}</li>
                ))}
              </ul>
            );
          case "p":
            return (
              <p key={key} className="mt-3 text-sm leading-6 text-slate-600 break-words">
                {block.lines.map((line, j) => (
                  <span key={j}>
                    {j > 0 && <br />}
                    {renderInline(line, `${key}-${j}`)}
                  </span>
                ))}
              </p>
            );
        }
      })}
    </>
  );
}
