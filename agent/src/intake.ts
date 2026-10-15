import type { Laws } from "./laws.js";
import { layerOfChange, pathProblems, type ChangedFile } from "./paths.js";
import type { Layer } from "./constitution.js";

export interface IntakeInput {
  files: ChangedFile[];
  /** Paths present at the base commit. */
  existingPaths: Iterable<string>;
  /** Every commit in the pull request: whether it has a Signed-off-by trailer, and whether its email is the author's (absent when unknown). */
  commits: Array<{ sha: string; signedOff: boolean; signoffMatchesAuthor?: boolean }>;
}

export interface IntakeResult {
  ok: boolean;
  layer: Layer;
  reasons: string[];
  /** Total bytes added or modified, for the size component. */
  bytesChanged: number;
}

const SYMLINK = "120000";
const SUBMODULE = "160000";

function ext(path: string): string {
  const i = path.lastIndexOf(".");
  const j = path.lastIndexOf("/");
  return i > j ? path.slice(i).toLowerCase() : "";
}

/** Law 8 and Law 6 intake checks. Pure: no network, no clock. */
export function intake(input: IntakeInput, laws: Laws): IntakeResult {
  const reasons: string[] = [];
  const { files } = input;
  const { layer } = layerOfChange(files);

  if (files.length === 0) reasons.push("change touches no file");
  if (layer === "constitution") reasons.push("change touches a Constitution-layer path");
  if (layer === "owner") reasons.push("change touches an owner-maintained file");
  if (layer === "ledger") reasons.push("change touches the ledger");

  for (const c of input.commits) {
    if (!c.signedOff) reasons.push(`commit ${c.sha.slice(0, 7)} lacks a Signed-off-by line`);
    else if (c.signoffMatchesAuthor === false) reasons.push(`commit ${c.sha.slice(0, 7)}: the Signed-off-by email is not the commit's author email (git commit -s writes a matching one; see DCO.md)`);
  }

  for (const p of pathProblems(files, input.existingPaths, laws)) reasons.push(`${p.path}: ${p.reason}`);

  let bytesChanged = 0;
  for (const f of files) {
    if (f.mode === SYMLINK) reasons.push(`${f.path}: symbolic link`);
    if (f.mode === SUBMODULE) reasons.push(`${f.path}: submodule`);
    bytesChanged += Math.max(0, f.bytesChanged);
    if (layer === "world" && f.status !== "removed") {
      if (laws.content.world_text_only && !laws.content.world_allowed_extensions.includes(ext(f.path))) {
        reasons.push(`${f.path}: file type not allowed in the World`);
      }
      if (f.sizeAfter > laws.content.max_file_kb * 1024) reasons.push(`${f.path}: larger than ${laws.content.max_file_kb} kB`);
    }
  }
  if (layer === "world" && bytesChanged > laws.content.max_contribution_kb * 1024) {
    reasons.push(`contribution changes more than ${laws.content.max_contribution_kb} kB`);
  }

  return { ok: reasons.length === 0, layer, reasons, bytesChanged };
}
