import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const isDesktop = (process.env.VITE_TARGET ?? env.VITE_TARGET) === "desktop";

  return {
    base: isDesktop ? "./" : "/",
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
    },
    plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
    resolve: {
      alias: [
        // In desktop builds, swap the data client for the local Electron shim.
        ...(isDesktop
          ? [{ find: "@/integrations/supabase/client", replacement: path.resolve(__dirname, "./src/integrations/desktop/client.ts") }]
          : []),
        { find: "@", replacement: path.resolve(__dirname, "./src") },
      ],
      dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
    },
  };
});
