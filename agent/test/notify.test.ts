import { describe, expect, it } from "vitest";
import { parseHeader, buildIndex } from "../src/questions.js";
import { DOORBELL_RE, mentionTargets, targetsOf, urlHash } from "../src/notify.js";
import { emptyState } from "../src/state.js";

describe("header convention", () => {
  it("parses a question, answers and cites", () => {
    const h = parseHeader("---\nnomicon:\n  question: \"Why?\"\n  answers: [world/a.md]\n  cites: [world/b.md, world/c.md]\n---\n\nbody");
    expect(h).toEqual({ question: "Why?", answers: ["world/a.md"], cites: ["world/b.md", "world/c.md"], challenges: [] });
  });
  it("ignores files without a header, malformed YAML, and headers without a nomicon key", () => {
    expect(parseHeader("# plain")).toBeNull();
    expect(parseHeader("---\n: : :\n---\n")).toBeNull();
    expect(parseHeader("---\ntitle: x\n---\n")).toBeNull();
  });
  it("tolerates CRLF and a byte-order mark", () => {
    expect(parseHeader("﻿---\r\nnomicon:\r\n  question: q\r\n---\r\nx")?.question).toBe("q");
  });
  it("builds an index split into open and answered", () => {
    const idx = buildIndex({
      a: { id: "a", question: "A?", asked_by: 1, asked_login: "u1", asked_at: 10, pr: 1, answers: [] },
      b: { id: "b", question: "B?", asked_by: 2, asked_login: "u2", asked_at: 5, pr: 2, answers: [{ path: "x", by: 3, login: "u3", merged_at: 20, pr: 3 }] },
    }, 100);
    expect(idx.open.map((q) => q.id)).toEqual(["a"]);
    expect(idx.answered.map((q) => q.id)).toEqual(["b"]);
  });
});

describe("notification targets", () => {
  const st = emptyState();
  st.pr_account[7] = 42;
  st.channels[42] = { doorbell: "active" }; st.channels[43] = { doorbell: "active" }; st.channels[44] = { doorbell: "retired" };
  it("sends a quote to its author and a vote open to author and qualified voters", () => {
    expect(targetsOf({ id: 1, at: 0, type: "quote", pr: 7 }, st)).toEqual([42]);
    expect(targetsOf({ id: 6, at: 0, type: "screen_deferred", pr: 7 }, st)).toEqual([42]);
    expect(targetsOf({ id: 7, at: 0, type: "screen_deferred", pr: 99, account: 55 }, st)).toEqual([55]);
    expect(targetsOf({ id: 8, at: 0, type: "intake_reject", pr: 98, account: 56 }, st)).toEqual([56]);
    expect(targetsOf({ id: 2, at: 0, type: "vote_open", pr: 7, qualified: [5, 9] }, st)).toEqual([5, 9, 42]);
  });
  it("sends a mention to its target and a digest to every active doorbell", () => {
    expect(targetsOf({ id: 3, at: 0, type: "notice", kind: "mention", target: 9 }, st)).toEqual([9]);
    expect(targetsOf({ id: 4, at: 0, type: "digest" }, st)).toEqual([42, 43]);
    expect(targetsOf({ id: 5, at: 0, type: "fee_adjust" }, st)).toEqual([]);
  });
  it("mentions askers and cited authors, skips the author, dedupes and caps", () => {
    st.questions["q1"] = { id: "q1", question: "?", asked_by: 11, asked_login: "a", asked_at: 0, pr: 1, answers: [] };
    st.path_author["p1"] = 12; st.path_author["p2"] = 12; st.path_author["p3"] = 13; st.path_author["mine"] = 99;
    const t = mentionTargets(99, { f: { answers: ["q1"], cites: ["p1", "p2", "p3", "mine"] } }, st, 2);
    expect(t.map((x) => x.account)).toEqual([11, 12]);
  });
  it("recognises doorbell registrations and hashes URLs", () => {
    expect(DOORBELL_RE.exec("doorbell: https://x.example/h")?.[1]).toBe("https://x.example/h");
    expect(DOORBELL_RE.exec("Doorbell: OFF")?.[1]).toBe("OFF");
    expect(DOORBELL_RE.exec("my doorbell: https://x")).toBeNull();
    expect(urlHash("https://x.example/h")).toHaveLength(16);
  });
});
