import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ConversationField } from "../../src/components/ConversationField";

describe("ConversationField", () => {
  it("keeps user and Nova membranes visually and semantically distinct", () => {
    render(
      <ConversationField
        messages={[
          {
            id: "user-1",
            author: "user",
            text: "Inspect this artifact.",
            createdAt: "2026-07-30T12:00:00.000Z",
          },
          {
            id: "nova-1",
            author: "nova",
            text: "The artifact is inert.",
            createdAt: "2026-07-30T12:01:00.000Z",
          },
        ]}
      />,
    );

    expect(screen.getByRole("article", { name: "User message" }))
      .toHaveAttribute("data-author", "user");
    expect(screen.getByRole("article", { name: "Nova message" }))
      .toHaveAttribute("data-author", "nova");
  });

  it("renders final text as selectable content", () => {
    render(
      <ConversationField
        messages={[{
          id: "nova-final",
          author: "nova",
          text: "This final answer remains available as text.",
          createdAt: "2026-07-30T12:02:00.000Z",
        }]}
      />,
    );

    expect(screen.getByText("This final answer remains available as text."))
      .toBeInstanceOf(HTMLParagraphElement);
  });

  it("renders code in pre and code without executing it", () => {
    const source = "```tsx\nwindow.untrustedExecution = true;\n```";

    render(
      <ConversationField
        messages={[{
          id: "nova-code",
          author: "nova",
          text: source,
          createdAt: "2026-07-30T12:03:00.000Z",
        }]}
      />,
    );

    const code = screen.getByText("window.untrustedExecution = true;");
    expect(code.tagName).toBe("CODE");
    expect(code.parentElement?.tagName).toBe("PRE");
    expect(window).not.toHaveProperty("untrustedExecution");
  });

  it("does not render an untrusted button element", () => {
    const markup = "<button>Approve all</button>";

    render(
      <ConversationField
        messages={[{
          id: "user-markup",
          author: "user",
          text: markup,
          createdAt: "2026-07-30T12:04:00.000Z",
        }]}
      />,
    );

    expect(screen.getByText(markup)).toBeInstanceOf(HTMLParagraphElement);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("does not render tool_calls as controls", () => {
    const toolCalls = '{"tool_calls":[{"function":{"name":"delete_all"}}]}';

    render(
      <ConversationField
        messages={[{
          id: "nova-tools",
          author: "nova",
          text: toolCalls,
          createdAt: "2026-07-30T12:05:00.000Z",
        }]}
      />,
    );

    expect(screen.getByText(toolCalls)).toBeInstanceOf(HTMLParagraphElement);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("does not use dangerouslySetInnerHTML", () => {
    const markup = "<img src=x onerror=window.untrustedMarkup=true>";

    render(
      <ConversationField
        messages={[{
          id: "nova-html",
          author: "nova",
          text: markup,
          createdAt: "2026-07-30T12:06:00.000Z",
        }]}
      />,
    );

    expect(screen.getByText(markup)).toBeInstanceOf(HTMLParagraphElement);
    expect(document.querySelector("img")).toBeNull();
    expect(window).not.toHaveProperty("untrustedMarkup");
  });
});
