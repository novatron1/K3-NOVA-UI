import { Fragment } from "react";

import { parseUntrustedContent } from "../security/untrusted-content";

export interface MessageContentProps {
  readonly text: string;
}

export function MessageContent({ text }: MessageContentProps) {
  return parseUntrustedContent(text).map((block, index) => (
    <Fragment key={index}>
      {block.kind === "text" ? (
        <p>{block.text}</p>
      ) : (
        <pre><code>{block.code}</code></pre>
      )}
    </Fragment>
  ));
}
