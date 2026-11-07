// Render build only (RENDER is set there; user 2026-11-07): installs what the API's text-layer reader needs
// (services/ocr/requirements-text.txt: PyMuPDF, numpy, OpenCV; no Paddle) into services/ocr/.pydeps, next to the code
// it runs. Render's native Node runtime has python3 and pip (Debian 12); Debian guards its own Python, so the packages
// go to their own folder (--target), with --break-system-packages only if pip still refuses. Elsewhere it does nothing.
// A failed install never fails the deploy: the reader then stays off (GET /api/health: textLayer "off") and every
// import waits for the OCR worker on the PC, as before.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (!process.env.RENDER) {
  console.log("[python-text-layer] not a Render build: skipped");
  process.exit(0);
}
const root = fileURLToPath(new URL("..", import.meta.url));
const install = ["-m", "pip", "install", "--no-cache-dir", "--disable-pip-version-check", "--upgrade",
  "--target", "services/ocr/.pydeps", "-r", "services/ocr/requirements-text.txt"];
for (const extra of [[], ["--break-system-packages"]]) {
  const result = spawnSync("python3", [...install, ...extra], { cwd: root, stdio: "inherit" });
  if (result.status === 0) {
    console.log("[python-text-layer] installed into services/ocr/.pydeps");
    process.exit(0);
  }
}
console.log("[python-text-layer] install failed: transcripts stay with the OCR worker");
