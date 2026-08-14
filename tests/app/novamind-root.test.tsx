import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { NovaMindRoot } from "../../src/app/NovaMindRoot";

describe("NovaMindRoot", () => {
  it("keeps the existing fake-host demo as the default runtime", async () => {
    render(<NovaMindRoot environment={{}} />);

    expect(screen.getByRole("heading", { name: "NovaMind" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("Ready for a message")).toBeInTheDocument();
    });
  });

  it("shows the sanitized unavailable state when remote mode has no valid host", async () => {
    render(<NovaMindRoot environment={{ VITE_NOVA_HOST_MODE: "remote" }} />);

    await waitFor(() => {
      expect(
        screen.getByText("The presentation host is unavailable."),
      ).toBeInTheDocument();
    });
  });
});
