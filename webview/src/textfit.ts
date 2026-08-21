// Re-measure themed text after a font change.
//
// A visual theme may swap a label's fontFamily (cath: Nunito → Cascadia for
// transition labels). Excalidraw keeps each text element's measured width and
// height in the element and renders it into an offscreen canvas of exactly
// that size, so a wider font is clipped on both sides until something
// re-measures the element (double-clicking into it does). This helper does
// what that double-click does — restoreElements({ refreshDimensions: true })
// re-wraps from originalText and re-measures — for every themed text element,
// once the font Excalidraw lazily loads is actually available, and keeps each
// label centred where it was.

import { FONT_FAMILY, restoreElements } from "@excalidraw/excalidraw";
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

const FAMILY_NAME_BY_ID = new Map<number, string>(
  Object.entries(FONT_FAMILY).map(([name, id]) => [id as number, name])
);

function isThemedText(element: any): boolean {
  return (
    element.type === "text" &&
    !element.isDeleted &&
    !!element.customData?.avTheme
  );
}

// Resolve once every font the themed labels use has a loaded FontFace.
// Excalidraw registers faces with document.fonts lazily (after the scene
// update that introduced the font), so document.fonts.load() may legitimately
// answer "no matching face" for a moment — poll briefly instead of giving up.
async function waitForFonts(families: Set<number>, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  const pending = new Set(families);
  while (pending.size && Date.now() < deadline) {
    for (const id of [...pending]) {
      const name = FAMILY_NAME_BY_ID.get(id);
      if (!name) {
        pending.delete(id);
        continue;
      }
      try {
        const faces = await document.fonts.load(`20px "${name}"`);
        if (faces.length) {
          pending.delete(id);
        }
      } catch {
        pending.delete(id);
      }
    }
    if (pending.size) {
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  }
}

let running = false;

/**
 * Re-measure every themed text element in the scene and re-centre it on its
 * previous midpoint. Idempotent: a second pass finds identical dimensions and
 * changes nothing, so calling it after every theme application or reload is
 * safe. Overlapping calls collapse into one.
 */
export async function refitThemedText(
  api: ExcalidrawImperativeAPI
): Promise<void> {
  if (running) {
    return;
  }
  running = true;
  try {
    // Let Excalidraw commit the scene update that introduced the new font and
    // kick off its font loading before we look.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const before = api.getSceneElementsIncludingDeleted() as readonly any[];
    const themed = before.filter(isThemedText);
    if (!themed.length) {
      return;
    }
    await waitForFonts(new Set(themed.map((el) => el.fontFamily)), 4000);

    // The scene may have changed while we waited; measure what is there now.
    const current = api.getSceneElementsIncludingDeleted() as readonly any[];
    const measured = restoreElements(current as any, null, {
      refreshDimensions: true,
      repairBindings: false,
    });
    const measuredById = new Map(measured.map((el) => [el.id, el as any]));

    let changed = false;
    const next = current.map((element) => {
      if (!isThemedText(element)) {
        return element;
      }
      const fresh = measuredById.get(element.id);
      if (!fresh) {
        return element;
      }
      const sameSize =
        Math.abs(fresh.width - element.width) < 0.5 &&
        Math.abs(fresh.height - element.height) < 0.5 &&
        fresh.text === element.text;
      if (sameSize) {
        return element;
      }
      changed = true;
      const centerX = element.x + element.width / 2;
      const centerY = element.y + element.height / 2;
      return {
        ...element,
        text: fresh.text,
        width: fresh.width,
        height: fresh.height,
        x: centerX - fresh.width / 2,
        y: centerY - fresh.height / 2,
        version: (element.version ?? 1) + 1,
        versionNonce: Math.floor(Math.random() * 2 ** 31),
        updated: Date.now(),
      };
    });

    if (changed) {
      api.updateScene({
        elements: next,
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      api.refresh();
    }
  } finally {
    running = false;
  }
}
