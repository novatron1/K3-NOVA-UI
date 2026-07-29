export type MessageBlock = Readonly<
  | {
    readonly kind: "text";
    readonly text: string;
  }
  | {
    readonly kind: "code";
    readonly language: string | null;
    readonly text: string;
  }
>;

const LANGUAGE_TOKEN = /^[a-zA-Z0-9_+#.-]{1,32}$/;

function textBlock(text: string): MessageBlock {
  return Object.freeze({ kind: "text" as const, text });
}

function codeBlock(language: string | null, text: string): MessageBlock {
  return Object.freeze({ kind: "code" as const, language, text });
}

function startsFence(text: string, index: number): boolean {
  return index === 0 || text[index - 1] === "\n";
}

function fenceLineEnd(text: string, index: number): number {
  const newline = text.indexOf("\n", index);
  return newline === -1 ? text.length : newline;
}

function languageAtFence(text: string, fenceStart: number): string | null | undefined {
  const lineEnd = fenceLineEnd(text, fenceStart + 3);
  let language = text.slice(fenceStart + 3, lineEnd);
  if (language.endsWith("\r")) {
    language = language.slice(0, -1);
  }

  if (language === "") {
    return null;
  }

  return LANGUAGE_TOKEN.test(language) ? language : undefined;
}

function closingFenceAt(text: string, start: number): number {
  let candidate = text.indexOf("```", start);
  while (candidate !== -1) {
    const afterFence = candidate + 3;
    const endsLine = afterFence === text.length
      || text[afterFence] === "\n"
      || (text[afterFence] === "\r" && text[afterFence + 1] === "\n");
    if (startsFence(text, candidate) && endsLine) {
      return candidate;
    }
    candidate = text.indexOf("```", candidate + 3);
  }
  return -1;
}

/**
 * Splits untrusted message text into inert text and fenced-code blocks.
 * It deliberately does not interpret markup, JSON, or control-like prose.
 */
export function parseUntrustedContent(text: string): readonly MessageBlock[] {
  const blocks: MessageBlock[] = [];
  let cursor = 0;
  let candidate = text.indexOf("```");

  while (candidate !== -1) {
    const language = startsFence(text, candidate)
      ? languageAtFence(text, candidate)
      : undefined;
    if (language === undefined) {
      candidate = text.indexOf("```", candidate + 3);
      continue;
    }

    const headerEnd = fenceLineEnd(text, candidate + 3);
    const contentStart = headerEnd === text.length ? text.length : headerEnd + 1;
    const closingFence = closingFenceAt(text, contentStart);
    if (candidate > cursor) {
      blocks.push(textBlock(text.slice(cursor, candidate)));
    }

    if (closingFence === -1) {
      blocks.push(codeBlock(language, text.slice(contentStart)));
      cursor = text.length;
      break;
    }

    blocks.push(codeBlock(language, text.slice(contentStart, closingFence)));
    cursor = closingFence + 3;
    candidate = text.indexOf("```", cursor);
  }

  if (cursor < text.length || blocks.length === 0) {
    blocks.push(textBlock(text.slice(cursor)));
  }

  return Object.freeze(blocks);
}
