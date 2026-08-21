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

// Unconnected-arrow highlight: Excalidraw bakes strokeColor into the rough.js
// drawable it caches per element, so the only place to recolor an arrow
// without writing to the file is the options generator (generateRoughOptions
// in @excalidraw/element Shape.ts). This transform makes the `stroke` option
// read globalThis.__AV_UNCONNECTED_ARROW_COLOR for arrows lacking a start or
// end binding; webview/src/unconnected.ts owns the global and App.tsx
// invalidates the caches when it changes.
//
// Second site: mutateElement only drops the cached drawable for geometry
// updates (height/width/fileId/points), so binding or unbinding an arrow on
// pointer-up — a pure startBinding/endBinding update — kept the stale stroke
// until something else regenerated it. The patch adds both binding keys to
// that condition so the arrow recolors the moment it is (dis)connected.
// Count-asserted like the link-icon patch so an Excalidraw upgrade that moves
// either site fails the build loudly.
function patchUnconnectedArrowStroke(): Plugin {
  let patched = 0;
  return {
    name: "av-patch-unconnected-arrow-stroke",
    transform(code, id) {
      if (!id.includes("@excalidraw/excalidraw/dist")) {
        return null;
      }
      let count = 0;
      // 1. generateRoughOptions: roughness:adjustRoughness(e),stroke:e.strokeColor,
      let out = code.replace(
        /roughness:\s*(\w+)\(\s*(\w+)\s*\)\s*,\s*stroke:\s*\2\.strokeColor\s*,/g,
        (_match, roughnessFn, e) => {
          count++;
          return (
            `roughness:${roughnessFn}(${e}),` +
            `stroke:(typeof globalThis.__AV_UNCONNECTED_ARROW_COLOR==="string"` +
            `&&${e}.type==="arrow"&&(!${e}.startBinding||!${e}.endBinding)` +
            `?globalThis.__AV_UNCONNECTED_ARROW_COLOR:${e}.strokeColor),`
          );
        }
      );
      // 2. mutateElement cache invalidation:
      //    typeof updates.height !== "undefined" || typeof updates.width !== "undefined" || ...
      //    (esbuild minifies the comparison to `typeof t.height<"u"`)
      out = out.replace(
        /typeof\s+(\w+)\.height\s*(?:!==?\s*"undefined"|<\s*"u")\s*\|\|\s*typeof\s+\1\.width\s*(?:!==?\s*"undefined"|<\s*"u")\s*\|\|/g,
        (match, updates) => {
          count++;
          return (
            `typeof ${updates}.startBinding!=="undefined"||` +
            `typeof ${updates}.endBinding!=="undefined"||` +
            match
          );
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
          `av-patch-unconnected-arrow-stroke: expected exactly 2 patch sites, got ${patched}. ` +
            "The @excalidraw/excalidraw bundle layout changed — update the regex in vite.config.ts."
        );
      }
    },
  };
}

// Themed chevron geometry: Excalidraw hard-codes the open "arrow" head to
// 25px arms at ±20° (getArrowheadSize / getArrowheadAngle in
// @excalidraw/element shapes.ts). A theme that wants a short, wide chevron has
// no element property to set, so this transform lets the two constants read
// globalThis.__AV_ARROWHEAD_SIZE / __AV_ARROWHEAD_ANGLE first (App.tsx sets
// them from the active VisualTheme's `arrowhead` and drops the shape cache).
// Render-only: nothing is written to the file. Count-asserted like the others.
function patchArrowheadGeometry(): Plugin {
  let patched = 0;
  return {
    name: "av-patch-arrowhead-geometry",
    transform(code, id) {
      if (!id.includes("@excalidraw/excalidraw/dist")) {
        return null;
      }
      let count = 0;
      // 1. getArrowheadSize: case "arrow": return 25;
      let out = code.replace(
        /case\s*"arrow"\s*:\s*return\s+25\s*;/g,
        () => {
          count++;
          return `case"arrow":return(typeof globalThis.__AV_ARROWHEAD_SIZE==="number"?globalThis.__AV_ARROWHEAD_SIZE:25);`;
        }
      );
      // 2. getArrowheadAngle: case "bar": return 90; case "arrow": return 20;
      out = out.replace(
        /case\s*"bar"\s*:\s*return\s+90\s*;\s*case\s*"arrow"\s*:\s*return\s+20\s*;/g,
        () => {
          count++;
          return `case"bar":return 90;case"arrow":return(typeof globalThis.__AV_ARROWHEAD_ANGLE==="number"?globalThis.__AV_ARROWHEAD_ANGLE:20);`;
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
          `av-patch-arrowhead-geometry: expected exactly 2 patch sites, got ${patched}. ` +
            "The @excalidraw/excalidraw bundle layout changed — update the regexes in vite.config.ts."
        );
      }
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    patchLinkIcons(),
    patchUnconnectedArrowStroke(),
    patchArrowheadGeometry(),
  ],
});
