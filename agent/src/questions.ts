/**
 * Law 12: the optional header a World file may carry, and the index of open
 * questions derived from merged contributions.
 *
 *   ---
 *   nomicon:
 *     question: "one line"
 *     answers: [world/path/of/question.md]
 *     cites: [world/path/of/entry.md]
 *   ---
 */
import { parse as parseYaml } from "yaml";

/** Law 12 map declarations: a file may be a node, may sit inside another node, and may claim edges. */
export interface MapNode { id: string; label: string; kind: string; domain: string; inside?: string }
export interface MapEdge { from?: string; to: string; type: string }
export interface MapDecl { node?: MapNode; edges: MapEdge[]; place_under: string[] }

export interface Header { question?: string; answers: string[]; cites: string[]; map?: MapDecl }

/** Node ids, domains and relation words: lowercase letters, digits and hyphens. */
export const MAP_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const MAP_REL = /^[a-z][a-z0-9-]{0,31}$/;
export const MAP_KINDS = new Set(["phys", "pop", "trans", "art", "poss", "part", "note", "question", "idea", "skill", "tool", "place", "person", "group"]);

function parseMap(v: unknown): MapDecl | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const id = (x: unknown): string | undefined => (typeof x === "string" && MAP_ID.test(x.trim()) ? x.trim() : undefined);
  const out: MapDecl = { edges: [], place_under: [] };
  const n = o["node"];
  if (n && typeof n === "object") {
    const no = n as Record<string, unknown>;
    const nid = id(no["id"]);
    if (nid) {
      const kind = typeof no["kind"] === "string" && MAP_KINDS.has(no["kind"].trim()) ? no["kind"].trim() : "idea";
      const label = typeof no["label"] === "string" && no["label"].trim() ? no["label"].trim().slice(0, 120) : nid;
      out.node = { id: nid, label, kind, domain: id(no["domain"]) ?? "general" };
      const inside = id(no["inside"]) ?? id(o["inside"]);
      if (inside && inside !== nid) out.node.inside = inside;
    }
  }
  if (Array.isArray(o["edges"])) {
    for (const e of o["edges"].slice(0, 50)) {
      if (!e || typeof e !== "object") continue;
      const eo = e as Record<string, unknown>;
      const to = id(eo["to"]); if (!to) continue;
      const type = typeof eo["type"] === "string" && MAP_REL.test(eo["type"].trim()) ? eo["type"].trim() : "rel";
      const from = id(eo["from"]);
      out.edges.push(from ? { from, to, type } : { to, type });
    }
  }
  if (Array.isArray(o["place_under"])) out.place_under = o["place_under"].map(id).filter((x): x is string => !!x).slice(0, 10);
  return out.node || out.edges.length || out.place_under.length ? out : undefined;
}

/** The first Markdown heading of a file, used as the label of a file that declares no node. */
export function titleOf(content: string): string | undefined {
  const body = content.replace(FRONT, "");
  const m = /^#\s+(.+)$/m.exec(body);
  return m ? m[1]!.trim().slice(0, 120) : undefined;
}

const FRONT = /^﻿?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/** Parse the header of a Markdown file. Malformed headers are ignored, never fatal. */
export function parseHeader(content: string): Header | null {
  const m = FRONT.exec(content);
  if (!m) return null;
  let doc: unknown;
  try { doc = parseYaml(m[1]!); } catch { return null; }
  if (!doc || typeof doc !== "object") return null;
  const n = (doc as Record<string, unknown>)["nomicon"];
  if (!n || typeof n !== "object") return null;
  const o = n as Record<string, unknown>;
  const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 512) : []);
  const h: Header = { answers: strs(o["answers"]), cites: strs(o["cites"]) };
  if (typeof o["question"] === "string" && o["question"].trim()) h.question = o["question"].trim().slice(0, 500);
  const map = parseMap(o["map"]);
  if (map) h.map = map;
  return h;
}

export interface Question {
  id: string;            // path of the file that asked it
  question: string;
  asked_by: number;
  asked_login: string;
  asked_at: number;
  pr: number;
  answers: Array<{ path: string; by: number; login: string; merged_at: number; pr: number }>;
}

export interface QuestionsIndex { version: 1; computed_at: number; open: Question[]; answered: Question[] }

export function buildIndex(questions: Record<string, Question>, now: number): QuestionsIndex {
  const all = Object.values(questions).sort((a, b) => a.asked_at - b.asked_at);
  return { version: 1, computed_at: now, open: all.filter((q) => q.answers.length === 0), answered: all.filter((q) => q.answers.length > 0) };
}
