import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ModalProvider } from "./components/ModalProvider";
import "./styles.css";

// The app is dark-only; set it before React paints. This replaces an inline
// script in index.html that the packaged app's CSP correctly blocked.
document.documentElement.classList.add("dark");

// Suppress the webview's default context menu outside text fields; a desktop app
// should not offer "Reload" and "Inspect" on a right click.
document.addEventListener("contextmenu", (event) => {
  const target = event.target as HTMLElement | null;
  const editable =
    target?.closest("input, textarea, [contenteditable='true'], .selectable") !=
    null;
  if (!editable) event.preventDefault();
});

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

createRoot(root).render(
  <StrictMode>
    <ModalProvider>
      <App />
    </ModalProvider>
  </StrictMode>,
);
