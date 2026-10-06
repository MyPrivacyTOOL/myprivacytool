import { createRoot } from "react-dom/client";
import App from "./App.tsx";
// MPC-7200: latin subsets only (the full css pulls ~40 @font-face rules incl. cyrillic/greek/vietnamese);
// the site is English-only. Browsers only download a unicode-range subset they need, but the CSS bloat and
// the lack of a preloadable file hurt first render.
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "@fontsource/fira-code/latin-400.css";
import "@fontsource/fira-code/latin-500.css";
import "./index.css";
import "./styles/hexagon.css";

createRoot(document.getElementById("root")!).render(<App />);