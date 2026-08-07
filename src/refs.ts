import * as vscode from "vscode";
import * as path from "path";

// Semantic ref allocation for interactively created elements (Phase 8).
// Mirrors the AutoVizerz diagram MCP's conventions exactly
// (AutoVizerz_API_Diagram/mcp/src/index.ts): refs are project-wide unique,
// never reused, and the on-disk elements/<ref>.md file is what reserves a ref
// against the MCP's own scan-based floor. Deliberate divergence: we do NOT
// write metadata.idCounters into the .excalidraw file — the webview save path
// (serializeAsJSON) drops custom top-level keys anyway, and the .md file on
// disk is sufficient to bump the MCP's floor.

// Accepts "elements/D1.md", legacy "#/D1.md" / "%23/D1.md", bare "D1.md",
// and per-diagram "elements-{name}/D1.md" — same regex as the MCP's extractRef.
export function extractRef(link: string | undefined): string | null {
  if (!link) {
    return null;
  }
  const match = link.match(
    /^(?:\.\/)?(?:elements(-[\w-]+)?\/|#\/|%23\/)?([A-Za-z0-9]+)\.md$/
  );
  return match ? match[2] : null;
}

const DOCS_SUBDIR = "elements";

function refNumber(ref: string, prefix: string): number | null {
  const match = new RegExp(`^${prefix}(\\d+)$`).exec(ref);
  return match ? parseInt(match[1], 10) : null;
}

// Highest existing number for `prefix` across every .excalidraw file in the
// workspace (element links + metadata.idCounters) and every elements*/ doc
// filename. A superset of the MCP's diagram-repo scan, so allocation here can
// only land higher than the MCP's floor, never collide below it.
async function scanRefFloor(prefix: string): Promise<number> {
  let floor = 0;
  const textDecoder = new TextDecoder();

  const diagramFiles = await vscode.workspace.findFiles(
    "**/*.excalidraw",
    "**/node_modules/**"
  );
  for (const uri of diagramFiles) {
    try {
      const raw = textDecoder.decode(await vscode.workspace.fs.readFile(uri));
      const data = JSON.parse(raw);
      for (const element of data.elements ?? []) {
        const ref = extractRef(element?.link);
        if (ref) {
          const n = refNumber(ref, prefix);
          if (n !== null && n > floor) {
            floor = n;
          }
        }
      }
      const counter = data.metadata?.idCounters?.[prefix];
      if (typeof counter === "number" && counter > floor) {
        floor = counter;
      }
    } catch {
      // A malformed or half-written diagram must not block allocation.
    }
  }

  const docFiles = await vscode.workspace.findFiles(
    `**/{${DOCS_SUBDIR},${DOCS_SUBDIR}-*}/*.md`,
    "**/node_modules/**"
  );
  for (const uri of docFiles) {
    const name = path.basename(uri.path, ".md");
    const n = refNumber(name, prefix);
    if (n !== null && n > floor) {
      floor = n;
    }
  }

  return floor;
}

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

// Mirror of the MCP's createElementDoc template for arrows.
function transitionDocContent(
  ref: string,
  label: string,
  diagramName: string
): string {
  return `# ${ref} — ${label}

**Type:** Transition
**Diagram:** ${diagramName}

---

## Purpose

<!-- Describe the purpose of this transition -->

---

## Details

<!-- Add detailed description, rules, business logic -->

---

## Related

<!-- Link to other elements, code, documentation -->
`;
}

export interface AllocatedArrowRef {
  ref: string;
  link: string;
}

// Serialize allocations: two quick connects in a row must not both scan before
// either one has written its reserving .md file.
let allocationQueue: Promise<unknown> = Promise.resolve();

/**
 * Allocate the next project-wide A# ref, create elements/A<N>.md next to the
 * diagram file, and return the ref + link to store on the arrow element.
 */
export function allocateArrowRef(
  documentUri: vscode.Uri,
  label: string,
  diagramName: string
): Promise<AllocatedArrowRef> {
  const run = async (): Promise<AllocatedArrowRef> => {
    const docsDirUri = vscode.Uri.joinPath(documentUri, "..", DOCS_SUBDIR);
    let next = (await scanRefFloor("A")) + 1;

    // Guard against a race with the MCP allocating between scan and write.
    for (let attempts = 0; attempts < 50; attempts++) {
      const docUri = vscode.Uri.joinPath(docsDirUri, `A${next}.md`);
      if (!(await fileExists(docUri))) {
        const ref = `A${next}`;
        await vscode.workspace.fs.createDirectory(docsDirUri);
        await vscode.workspace.fs.writeFile(
          docUri,
          new TextEncoder().encode(
            transitionDocContent(ref, label, diagramName)
          )
        );
        return { ref, link: `${DOCS_SUBDIR}/${ref}.md` };
      }
      next++;
    }
    throw new Error("Could not allocate a free arrow ref after 50 attempts");
  };

  const result = allocationQueue.then(run, run);
  allocationQueue = result.catch(() => undefined);
  return result;
}
