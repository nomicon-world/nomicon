import { describe, expect, it } from "vitest";
import { parseLaws, LawsError } from "../src/laws.js";
import { rawLaws, rawSchema, withLaws } from "./helpers.js";

describe("laws.json loading", () => {
  it("accepts the repository's laws.json", () => {
    const l = parseLaws(rawLaws, rawSchema);
    expect(l.laws.version).toBe(13);
    expect(l.hash).toHaveLength(64);
  });
  const refused = (name: string, mutate: Parameters<typeof withLaws>[0], expectText: string) =>
    it(`refuses ${name}`, () => {
      let err: unknown;
      try { parseLaws(withLaws(mutate), rawSchema); } catch (e) { err = e; }
      expect(err).toBeInstanceOf(LawsError);
      expect((err as LawsError).problems.join(" ")).toContain(expectText);
    });
  refused("a 1-hour window", (l) => { l.vote.world.window_hours = 1; }, "window");
  refused("quorum of one", (l) => { l.vote.world.quorum_yes_voters = 1; }, "quorum");
  refused("simple-majority Laws", (l) => { (l.vote.laws as { majority: string }).majority = "simple_weight"; }, "majority");
  refused("zero maturity", (l) => { l.weight.maturity_days = 0; }, "maturity");
  refused("one-day half-life", (l) => { l.weight.decay_half_life_days = 1; }, "half_life");
  refused("a fee floor of zero", (l) => { l.fee.floor_usdc = 0; }, "floor");
  refused("a fee cap of 1x", (l) => { l.fee.cap_multiple_of_floor = 1; }, "cap");
  refused("laws multiplier equal to world", (l) => { l.fee.layer_multiplier.laws = 1; }, "multiplier");
  refused("a one-day Laws effect delay", (l) => { l.vote.laws.effect_delay_days = 1; }, "effect_delay");
  refused("a 10-year expiry hold", (l) => { l.fee.expiry_hold_days = 3650; }, "expiry_hold");
  refused("a 50% per-account cap", (l) => { l.weight.per_account_cap_percent = 50; }, "per_account_cap");
  refused("author voting", (l) => { (l.vote as { author_may_vote: boolean }).author_may_vote = true; }, "author_may_vote");
  refused("laws window shorter than world", (l) => { l.vote.laws.window_hours = 48; }, "easier");
  refused("a free size charge", (l) => { l.fee.size_per_kb_usdc = 0; }, "size component");
  refused("a 1 MB size-free allowance", (l) => { l.fee.size_free_kb = 1024; }, "allowance");
});
