import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { NovaMindRoot } from "../../src/app/NovaMindRoot";

afterEach(() => {
  cleanup();
});

describe("NovaMindRoot", () => {
  it("keeps the existing fake-host demo as the default runtime", async () => {
    render(<NovaMindRoot environment={{}} />);

    expect(screen.getByRole("heading", { name: "NovaMind" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getAllByText("Ready for a message").length).toBeGreaterThan(0);
    });
  });

  it("shows the sanitized unavailable state when remote mode has no valid host", async () => {
    render(<NovaMindRoot environment={{ VITE_NOVA_HOST_MODE: "remote" }} />);

    await waitFor(() => {
      expect(screen.getAllByText("NovaMind host unavailable").length).toBeGreaterThan(0);
    });
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
  });
});
