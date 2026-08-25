import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { NovaMindDemo } from "./app/NovaMindDemo";
import "./theme/global.css";

const rootElement = document.getElementById("root");

if (rootElement === null) {
  throw new Error("NovaMind root element is unavailable.");
}

createRoot(rootElement).render(
  <StrictMode>
    <NovaMindDemo />
  </StrictMode>,
);
