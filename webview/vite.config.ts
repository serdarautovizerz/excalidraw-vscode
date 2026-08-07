import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// Excalidraw draws the chain link icon on its interactive canvas — no prop or
// CSS can hide it. This build-time transform injects a runtime kill switch
// (globalThis.__AV_SHOW_LINK_ICONS, toggled by App.tsx with the
// excalidraw.enableCustomFeatures setting) into the two guards that gate the
// icon: renderLinkIcon (draw) and isPointHittingLink (the invisible click
// zone). The regexes tolerate minification; the count assertion makes any
// @excalidraw/excalidraw upgrade that moves these sites fail the build loudly
// instead of silently un-hiding the icons. Dependency pinned to exact 0.18.1.
function patchLinkIcons(): Plugin {
  let patched = 0;
  return {
    name: "av-patch-link-icons",
    transform(code, id) {
      if (!id.includes("@excalidraw/excalidraw/dist")) {
        return null;
      }
      let count = 0;
      // 1. renderLinkIcon: if(e.link&&!n.selectedElementIds[e.id])
      let out = code.replace(
        /if\s*\(\s*(\w+)\.link\s*&&\s*!\s*(\w+)\.selectedElementIds\[\1\.id\]\s*\)/g,
        (_match, e, a) => {
          count++;
          return `if(${e}.link&&!${a}.selectedElementIds[${e}.id]&&globalThis.__AV_SHOW_LINK_ICONS!==false)`;
        }
      );
      // 2. isPointHittingLink: !e.link||n.selectedElementIds[e.id]
      //    (an if-statement in the dev bundle, a ternary condition in prod —
      //    wrapping in parentheses keeps both forms valid)
      out = out.replace(
        /!\s*(\w+)\.link\s*\|\|\s*(\w+)\.selectedElementIds\[\1\.id\]/g,
        (_match, e, a) => {
          count++;
          return `(globalThis.__AV_SHOW_LINK_ICONS===false||!${e}.link||${a}.selectedElementIds[${e}.id])`;
        }
      );
      if (count === 0) {
        return null;
      }
      patched += count;
      return { code: out, map: null };
    },
    closeBundle() {
      if (patched !== 2) {
        throw new Error(
          `av-patch-link-icons: expected exactly 2 patch sites, got ${patched}. ` +
            "The @excalidraw/excalidraw bundle layout changed — update the regexes in vite.config.ts."
        );
      }
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), patchLinkIcons()],
});
