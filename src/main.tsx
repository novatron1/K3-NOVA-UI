import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { NovaMindApp } from "./app/NovaMindApp";
import { createInitialPresentationState } from "./state/presentation-reducer";
import "./theme/global.css";

const rootElement = document.getElementById("root");

if (rootElement === null) {
  throw new Error("NovaMind root element is unavailable.");
}

createRoot(rootElement).render(
  <StrictMode>
    <NovaMindApp state={createInitialPresentationState()} />
  </StrictMode>,
);
