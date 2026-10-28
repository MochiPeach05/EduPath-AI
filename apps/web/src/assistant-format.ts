import { createElement, type ReactNode } from "react";
import type { AssistantSource } from "./assistant-types";

// Trợ lý AI (STU-CHAT-01..05): an answer as React nodes, never as HTML. The model writes plain text with "- " bullets,
// "1. " numbered lines, **bold** and [n] citations; an https:// address becomes a link that opens in a new tab. Any other
// markup or scheme stays text, which React escapes.

/** A piece of a line. */
export type AnswerInline =
  | { kind: "text"; text: string }
  | { kind: "bold"; children: AnswerInline[] }
  | { kind: "cite"; n: number }
  | { kind: "link"; href: string; text: string };

/** A line of the answer, as pieces. */
export type AnswerLine = AnswerInline[];

/** A block of the answer. A paragraph and a list item keep the line breaks the model wrote. */
export type AnswerBlock =
  | { kind: "paragraph"; lines: AnswerLine[] }
  | { kind: "heading"; content: AnswerLine }
  | { kind: "bullets"; items: AnswerLine[][] }
  | { kind: "numbered"; start: number; items: AnswerLine[][] };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*(\d{1,2})[.)]\s+(.*)$/;
// Not in the contract, but small models write "### Title" now and then: shown as a bold line instead of the hashes.
const HEADING = /^\s*#{1,6}\s+(.*)$/;
const INDENTED = /^(?: {2,}|\t)\S/;

/**
 * **bold** | [text](https://…) | [1] or [1, 2] | a bare https:// address. A URL stops at spaces, quotes, angle brackets,
 * square brackets and "*", so a citation or bold mark right after it is not swallowed.
 */
const INLINE = /\*\*(?=\S)(.+?)(?<=\S)\*\*|\[([^\]\n]{1,200})\]\((https:\/\/[^\s()<>"'`]+)\)|\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\]|https:\/\/[^\s<>"'`*[\]]+/g;

/** The address of a link, or null for anything that is not a plain https:// address (another scheme, a login in it, no host). */
export function safeHttpsUrl(raw: string): string | null {
  if (!/^https:\/\/\S+$/i.test(raw)) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && url.hostname && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

/** A bare address ends before the punctuation of its sentence; ")" stays when the address opened one. */
function trimUrl(raw: string): string {
  let url = raw;
  for (;;) {
    if (/[.,;:!?…'"”’»]$/.test(url)) url = url.slice(0, -1);
    else if (url.endsWith(")") && url.split("(").length < url.split(")").length) url = url.slice(0, -1);
    else return url;
  }
}

function lineInlines(text: string, insideBold: boolean): AnswerLine {
  const out: AnswerLine = [];
  const addText = (value: string) => {
    if (!value) return;
    const last = out[out.length - 1];
    if (last?.kind === "text") last.text += value;
    else out.push({ kind: "text", text: value });
  };
  let at = 0;
  for (const match of text.matchAll(INLINE)) {
    const [whole, bold, linkText, linkUrl, cites] = match;
    const start = match.index;
    let end = start + whole.length;
    let pieces: AnswerInline[] | null = null;
    if (bold !== undefined) {
      pieces = insideBold ? null : [{ kind: "bold", children: lineInlines(bold, true) }];
    } else if (linkUrl !== undefined) {
      const href = safeHttpsUrl(linkUrl);
      pieces = href ? [{ kind: "link", href, text: linkText.trim() || linkUrl }] : null;
    } else if (cites !== undefined) {
      pieces = cites.split(",").map((n) => Number(n.trim())).filter((n) => n > 0).map((n) => ({ kind: "cite", n }));
    } else {
      const url = trimUrl(whole);
      const href = safeHttpsUrl(url);
      end = start + url.length;
      pieces = href ? [{ kind: "link", href, text: url }] : null;
    }
    // Not a piece after all (e.g. an address that does not parse): it stays text, picked up with what follows.
    if (!pieces?.length) continue;
    addText(text.slice(at, start));
    out.push(...pieces);
    at = end;
  }
  addText(text.slice(at));
  return out;
}

/** One line of text as pieces: bold, links and citations; the rest text. */
export const parseInline = (text: string): AnswerLine => lineInlines(text, false);

/**
 * The answer as blocks. Blank lines end a paragraph; consecutive "- " (or "* ", "• ") lines make one list and
 * consecutive "1. " lines one numbered list, also across blank lines; an indented line right under a list item
 * continues that item.
 */
export function parseAnswer(text: string): AnswerBlock[] {
  const blocks: AnswerBlock[] = [];
  let paragraph: string[] = [];
  let list: { kind: "bullets" | "numbered"; start: number; items: string[][] } | null = null;
  let blankSinceItem = false;
  const endParagraph = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", lines: paragraph.map(parseInline) });
    paragraph = [];
  };
  const endList = () => {
    if (list) {
      const items = list.items.map((lines) => lines.map(parseInline));
      blocks.push(list.kind === "bullets" ? { kind: "bullets", items } : { kind: "numbered", start: list.start, items });
    }
    list = null;
  };
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) { endParagraph(); blankSinceItem = true; continue; }
    const bullet = BULLET.exec(raw);
    const numbered = bullet ? null : NUMBERED.exec(raw);
    if (bullet || numbered) {
      endParagraph();
      const kind = bullet ? "bullets" : "numbered";
      if (!list || list.kind !== kind) {
        endList();
        list = { kind, start: numbered ? Number(numbered[1]) : 1, items: [] };
      }
      list.items.push([(bullet ? bullet[1] : numbered![2]).trim()]);
      blankSinceItem = false;
      continue;
    }
    if (list && !blankSinceItem && INDENTED.test(raw)) {
      list.items[list.items.length - 1].push(line);
      continue;
    }
    endList();
    const heading = HEADING.exec(raw);
    if (heading) {
      endParagraph();
      blocks.push({ kind: "heading", content: parseInline(heading[1].trim()) });
    } else {
      paragraph.push(line);
    }
    blankSinceItem = false;
  }
  endParagraph();
  endList();
  return blocks;
}

export type AnswerFormatOptions = {
  /** The answer's sources. A citation with a source becomes a button; one without (e.g. while the answer is written) stays "[n]". */
  sources?: readonly AssistantSource[];
  /** A click on citation n. */
  onCite?: (n: number) => void;
};

function inlineNodes(pieces: AnswerLine, options: AnswerFormatOptions, key: string): ReactNode[] {
  return pieces.map((piece, index) => {
    const id = `${key}.${index}`;
    switch (piece.kind) {
      case "text":
        return piece.text;
      case "bold":
        return createElement("strong", { key: id }, inlineNodes(piece.children, options, id));
      case "link":
        return createElement("a", { key: id, href: piece.href, target: "_blank", rel: "noopener noreferrer" },
          piece.text, createElement("span", { className: "sr-only" }, " (mở trong tab mới)"));
      case "cite": {
        const source = options.sources?.find((item) => item.n === piece.n);
        const onCite = options.onCite;
        if (!source || !onCite) return createElement("sup", { key: id, className: "as-cite" }, `[${piece.n}]`);
        return createElement("sup", { key: id, className: "as-cite" }, createElement("button", {
          type: "button", className: "as-cite-button", title: source.title, "aria-label": `Xem nguồn ${piece.n}: ${source.title}`,
          onClick: () => onCite(piece.n),
        }, String(piece.n)));
      }
    }
  });
}

/** Lines joined by line breaks. */
function lineNodes(lines: AnswerLine[], options: AnswerFormatOptions, key: string): ReactNode[] {
  return lines.flatMap((line, index) => [
    ...(index ? [createElement("br", { key: `${key}.br${index}` })] : []),
    ...inlineNodes(line, options, `${key}.${index}`),
  ]);
}

/** The answer text as paragraphs and lists. */
export function formatAnswer(text: string, options: AnswerFormatOptions = {}): ReactNode[] {
  return parseAnswer(text).map((block, index) => {
    const key = `b${index}`;
    switch (block.kind) {
      case "paragraph":
        return createElement("p", { key }, lineNodes(block.lines, options, key));
      case "heading":
        return createElement("p", { key, className: "as-answer-heading" }, createElement("strong", null, inlineNodes(block.content, options, key)));
      case "bullets":
        return createElement("ul", { key }, block.items.map((item, i) => createElement("li", { key: i }, lineNodes(item, options, `${key}.${i}`))));
      case "numbered":
        return createElement("ol", { key, start: block.start === 1 ? undefined : block.start },
          block.items.map((item, i) => createElement("li", { key: i }, lineNodes(item, options, `${key}.${i}`))));
    }
  });
}
