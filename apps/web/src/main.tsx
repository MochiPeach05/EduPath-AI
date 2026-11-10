import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { PageErrorBoundary } from "./page-errors";
import { syncPageScale } from "./page-scale";
import "./styles.css";
import "./ui-controls.css";
import "./display-format.css";

const root = document.getElementById("root");
if (!root) throw new Error("Root element was not found");

// The admin portal keeps its 80% desktop scale, every other page is drawn at 100% (styles.css): marked before the first
// paint, and again should Back or Forward move the tab to the other portal without loading the page.
syncPageScale();
window.addEventListener("popstate", () => syncPageScale());

createRoot(root).render(
  <StrictMode>
    {/* Anything that fails to draw outside a portal page: a message and "Tải lại trang", never a blank screen. */}
    <PageErrorBoundary whole>
      <App />
    </PageErrorBoundary>
  </StrictMode>
);
