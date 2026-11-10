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

// Each page's scale (page-scale.ts, styles.css) by its address, before the first paint; the pages that a session check
// may swap (Đăng nhập, the student portal) set their own with usePageScale.
syncPageScale();

createRoot(root).render(
  <StrictMode>
    {/* Anything that fails to draw outside a portal page: a message and "Tải lại trang", never a blank screen. */}
    <PageErrorBoundary whole>
      <App />
    </PageErrorBoundary>
  </StrictMode>
);
