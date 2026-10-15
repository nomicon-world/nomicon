import { describe, expect, it } from "vitest";
import { intake } from "../src/intake.js";
import { signoffEmails } from "../src/adapters/github.js";
import type { ChangedFile } from "../src/paths.js";
import { laws } from "./helpers.js";

const f = (path: string, over: Partial<ChangedFile> = {}): ChangedFile => ({ path, status: "added", mode: "100644", bytesChanged: 100, sizeAfter: 100, ...over });
const commits = [{ sha: "abc1234", signedOff: true }];
const existing = ["README.md", "world/replicator-map/nodes.json", "LAWS.md"];

describe("intake", () => {
  it("accepts a plain World text change", () => {
    const r = intake({ files: [f("world/notes/a.md")], existingPaths: existing, commits }, laws);
    expect(r.ok).toBe(true);
    expect(r.layer).toBe("world");
    expect(r.bytesChanged).toBe(100);
  });
  it("rejects a change that touches no file", () => {
    expect(intake({ files: [], existingPaths: existing, commits }, laws).reasons).toContain("change touches no file");
  });
  it("rejects any touch of a Constitution path, including a delete and a rename away", () => {
    expect(intake({ files: [f("TERMS.md", { status: "removed" })], existingPaths: existing, commits }, laws).ok).toBe(false);
    expect(intake({ files: [f("world/x.md", { status: "renamed", previousPath: "LAWS.md" })], existingPaths: existing, commits }, laws).layer).toBe("laws");
    expect(intake({ files: [f("world/x.md", { status: "renamed", previousPath: "CONSTITUTION.md" })], existingPaths: existing, commits }, laws).ok).toBe(false);
  });
  it("classifies a mixed change by the strictest layer", () => {
    expect(intake({ files: [f("world/a.md"), f("README.md", { status: "modified" })], existingPaths: existing, commits }, laws).layer).toBe("laws");
  });
  it("rejects symlinks and submodules", () => {
    expect(intake({ files: [f("world/l", { mode: "120000" })], existingPaths: existing, commits }, laws).reasons.join()).toContain("symbolic link");
    expect(intake({ files: [f("world/s", { mode: "160000" })], existingPaths: existing, commits }, laws).reasons.join()).toContain("submodule");
  });
  it("rejects a missing sign-off", () => {
    const r = intake({ files: [f("world/a.md")], existingPaths: existing, commits: [{ sha: "deadbeef", signedOff: false }] }, laws);
    expect(r.reasons.join()).toContain("Signed-off-by");
  });
  it("rejects a sign-off whose email is not the author's, and passes when unknown", () => {
    const bad = intake({ files: [f("world/a.md")], existingPaths: existing, commits: [{ sha: "deadbeef", signedOff: true, signoffMatchesAuthor: false }] }, laws);
    expect(bad.reasons.join()).toContain("not the commit's author email");
    expect(intake({ files: [f("world/a.md")], existingPaths: existing, commits: [{ sha: "deadbeef", signedOff: true, signoffMatchesAuthor: true }] }, laws).ok).toBe(true);
    expect(intake({ files: [f("world/a.md")], existingPaths: existing, commits: [{ sha: "deadbeef", signedOff: true }] }, laws).ok).toBe(true);
  });
  it("reads every sign-off email from a commit message", () => {
    const msg = "Add a file\n\nSigned-off-by: A Person <A@Example.org>\nSigned-off-by: Bot <1+bot@users.noreply.github.com>\n";
    expect(signoffEmails(msg)).toEqual(["a@example.org", "1+bot@users.noreply.github.com"]);
    expect(signoffEmails("Signed-off-by: no email")).toEqual([]);
  });
  it("rejects case collisions with existing paths and within the change", () => {
    expect(intake({ files: [f("readme.md")], existingPaths: existing, commits }, laws).reasons.join()).toContain("ignoring case");
    expect(intake({ files: [f("world/A.md"), f("world/a.md")], existingPaths: existing, commits }, laws).reasons.join()).toContain("ignoring case");
  });
  it("rejects non-ASCII, dot-dot and empty components", () => {
    expect(intake({ files: [f("world/wоrld.md")], existingPaths: existing, commits }, laws).ok).toBe(false);
    expect(intake({ files: [f("world/../LAWS.md")], existingPaths: existing, commits }, laws).ok).toBe(false);
    expect(intake({ files: [f("world//a.md")], existingPaths: existing, commits }, laws).ok).toBe(false);
  });
  it("rejects disallowed types and oversized files in the World only", () => {
    expect(intake({ files: [f("world/a.html")], existingPaths: existing, commits }, laws).reasons.join()).toContain("not allowed");
    expect(intake({ files: [f("world/a.md", { sizeAfter: 300 * 1024 })], existingPaths: existing, commits }, laws).reasons.join()).toContain("larger than");
    expect(intake({ files: [f("world/a.md", { bytesChanged: 2 * 1024 * 1024 })], existingPaths: existing, commits }, laws).reasons.join()).toContain("more than");
    const lawsChange = intake({ files: [f("site/x.html", { status: "modified" })], existingPaths: existing, commits }, laws);
    expect(lawsChange.ok).toBe(true);
  });
  it("rejects touching the ledger or owner files", () => {
    expect(intake({ files: [f("ledger/events.jsonl", { status: "modified" })], existingPaths: existing, commits }, laws).ok).toBe(false);
    expect(intake({ files: [f("NOTICES.md", { status: "modified" })], existingPaths: existing, commits }, laws).ok).toBe(false);
  });
});
