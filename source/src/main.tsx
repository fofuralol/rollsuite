import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { applyStoredZoom, bindZoomAutoResize } from "./lib/applyZoom";

applyStoredZoom();
bindZoomAutoResize();

createRoot(document.getElementById("root")!).render(<App />);
