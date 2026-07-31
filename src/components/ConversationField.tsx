import type { UntrustedMessage } from "../domain/presentation-types";

import { MessageContent } from "./MessageContent";

export interface ConversationFieldProps {
  readonly messages: readonly UntrustedMessage[];
}

function messageLabel(author: UntrustedMessage["author"]): string {
  return author === "user" ? "User message" : "Nova message";
}

export function ConversationField({ messages }: ConversationFieldProps) {
  return (
    <div className="conversation-field">
      {messages.map((message) => (
        <article
          key={message.id}
          className={`conversation-message conversation-message--${message.author}`}
          data-author={message.author}
          aria-label={messageLabel(message.author)}
        >
          <MessageContent text={message.text} />
        </article>
      ))}
    </div>
  );
}
