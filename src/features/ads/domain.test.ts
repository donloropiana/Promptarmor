// Characterization tests for the ads domain rules (./domain): tabs and
// statuses, the lifecycle after approval, channels, ranking and reason tags.
// Run with: bun test src/features/ads/domain.test.ts
// @ts-expect-error -- bun:test types are not installed; Bun provides the module at test time.
import { describe, expect, test } from "bun:test";

import {
  adTags,
  channelLabel,
  isLive,
  isNotScreened,
  liveChannelLabel,
  normaliseChannel,
  parseTab,
  rankAd,
  reReviewTag,
  statusWord,
  tabForAsset,
  tabForStatus,
  type AdRankInput,
  type AdTagInput,
  type Lifecycle,
} from "./domain";

const NOW = Date.parse("2026-11-07T12:00:00Z");
const ad = (over: Partial<AdRankInput>): AdRankInput => ({
  hiddenText: false,
  openCritical: 0,
  openMajor: 0,
  openMinor: 0,
  submittedAt: "2026-11-07T10:00:00Z",
  ...over,
});

describe("rankAd", () => {
  test("worst first: hidden text, then critical, major, minor", () => {
    const ranks = [ad({ hiddenText: true }), ad({ openCritical: 1 }), ad({ openMajor: 1 }), ad({ openMinor: 1 }), ad({})].map((a) => rankAd(a, NOW));
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });

  test("an open minor issue outranks a clean ad, whatever their ages", () => {
    expect(rankAd(ad({ openMinor: 1, submittedAt: "2026-11-07T11:59:00Z" }), NOW)).toBeLessThan(rankAd(ad({ submittedAt: "2026-01-01T00:00:00Z" }), NOW));
  });

  test("older first among equals", () => {
    expect(rankAd(ad({ openMajor: 2, submittedAt: "2026-11-01T00:00:00Z" }), NOW)).toBeLessThan(rankAd(ad({ openMajor: 1 }), NOW));
  });

  test("hidden text alone outranks every other issue combined", () => {
    const loaded = ad({ openCritical: 3, openMajor: 3, openMinor: 3, submittedAt: "2026-01-01T00:00:00Z" });
    expect(rankAd(ad({ hiddenText: true }), NOW)).toBeLessThan(rankAd(loaded, NOW));
  });

  test("only whether issues are open counts, not how many", () => {
    expect(rankAd(ad({ openCritical: 1, submittedAt: "2026-11-01T00:00:00Z" }), NOW)).toBeLessThan(rankAd(ad({ openCritical: 5 }), NOW));
  });

  test("the key's encoding: one band per issue kind, then age in ms", () => {
    const justNow = new Date(NOW).toISOString();
    expect(rankAd(ad({ submittedAt: justNow }), NOW)).toBe(1_112_000_000_000_000);
    expect(rankAd(ad({ hiddenText: true, openCritical: 1, openMajor: 1, openMinor: 1, submittedAt: justNow }), NOW)).toBe(1_000_000_000_000);
    expect(rankAd(ad({ submittedAt: new Date(NOW - 60_000).toISOString() }), NOW)).toBe(1_112_000_000_000_000 - 60_000);
  });

  test("a submission time in the future counts as just submitted", () => {
    expect(rankAd(ad({ submittedAt: "2026-11-08T00:00:00Z" }), NOW)).toBe(rankAd(ad({ submittedAt: new Date(NOW).toISOString() }), NOW));
  });
});

const tagInput = (over: Partial<AdTagInput>): AdTagInput => ({
  status: "needs_review",
  versionNo: 1,
  hasDecisions: false,
  hiddenText: false,
  changedAfterApproval: false,
  notScreened: false,
  isSample: false,
  reReviewReason: null,
  ...over,
});

describe("adTags", () => {
  test("in display order", () => {
    expect(
      adTags(tagInput({ isSample: true, hiddenText: true, status: "re_review_due", reReviewReason: { kind: "expired" }, changedAfterApproval: true, notScreened: true, versionNo: 3 })),
    ).toEqual(["Sample", "Hidden text", "Expired", "Changed after approval", "Not AI-screened", "V3"]);
  });

  test("New and V<n> only while the ad waits for a decision", () => {
    expect(adTags(tagInput({}))).toEqual(["New"]);
    expect(adTags(tagInput({ hasDecisions: true }))).toEqual([]);
    expect(adTags(tagInput({ status: "changes_requested", versionNo: 2 }))).toEqual(["V2"]);
    expect(adTags(tagInput({ status: "rejected", versionNo: 2, hasDecisions: true }))).toEqual([]);
    expect(adTags(tagInput({ status: "withdrawn" }))).toEqual([]);
    expect(adTags(tagInput({ status: "approved_with_exceptions", versionNo: 2, hasDecisions: true }))).toEqual(["With exceptions"]);
  });

  test("re-review reason defaults to rates changed", () => {
    expect(adTags(tagInput({ status: "re_review_due", reReviewReason: { kind: "offer_changed" }, hasDecisions: true }))).toEqual(["Rates changed"]);
  });

  test("every needs-review status gets the version tag", () => {
    for (const status of ["needs_review", "needs_manual_review", "recheck_ready", "re_review_due"]) {
      expect(adTags(tagInput({ status, versionNo: 2, hasDecisions: true })).at(-1)).toBe("V2");
    }
  });

  test("a later version shows V<n> even before any decision", () => {
    expect(adTags(tagInput({ status: "recheck_ready", versionNo: 4 }))).toEqual(["V4"]);
  });

  test("approved ads carry only their approval-side tags", () => {
    expect(adTags(tagInput({ status: "approved", versionNo: 3, hasDecisions: true }))).toEqual([]);
    expect(adTags(tagInput({ status: "approved_with_exceptions", versionNo: 3, hasDecisions: true, changedAfterApproval: true }))).toEqual([
      "With exceptions",
      "Changed after approval",
    ]);
  });

  test("not AI-screened sits before New", () => {
    expect(adTags(tagInput({ status: "needs_manual_review", notScreened: true }))).toEqual(["Not AI-screened", "New"]);
  });
});

describe("reReviewTag", () => {
  test("only an object whose kind is expired reads as Expired", () => {
    expect(reReviewTag({ kind: "expired" })).toBe("Expired");
    expect(reReviewTag({ kind: "offer_changed", offers: ["PL-1"] })).toBe("Rates changed");
    expect(reReviewTag(null)).toBe("Rates changed");
    expect(reReviewTag("expired")).toBe("Rates changed");
    expect(reReviewTag([{ kind: "expired" }])).toBe("Rates changed");
  });
});

describe("isNotScreened", () => {
  test("only an ad waiting on a person whose latest check did not complete", () => {
    expect(isNotScreened("needs_manual_review", "failed")).toBe(true);
    expect(isNotScreened("needs_manual_review", null)).toBe(true);
    expect(isNotScreened("needs_manual_review", "complete")).toBe(false);
    expect(isNotScreened("approved", "failed")).toBe(false);
  });
});

describe("parseTab", () => {
  test("accepts every tab key", () => {
    for (const key of ["needs_review", "changes_requested", "approved", "live", "archived", "all"]) {
      expect(parseTab(key)).toBe(key);
    }
  });

  test("takes the first of repeated query values", () => {
    expect(parseTab(["live", "approved"])).toBe("live");
  });

  test("anything else falls back to Needs review", () => {
    expect(parseTab(undefined)).toBe("needs_review");
    expect(parseTab([])).toBe("needs_review");
    expect(parseTab("")).toBe("needs_review");
    expect(parseTab("Approved")).toBe("needs_review");
    expect(parseTab("rejected")).toBe("needs_review");
    expect(parseTab(["bogus", "approved"])).toBe("needs_review");
  });
});

describe("tabForStatus and statusWord", () => {
  test("each status maps to its tab and word", () => {
    const table: [string, ReturnType<typeof tabForStatus>, ReturnType<typeof statusWord>][] = [
      ["needs_review", "needs_review", "Needs review"],
      ["needs_manual_review", "needs_review", "Needs review"],
      ["recheck_ready", "needs_review", "Needs review"],
      ["re_review_due", "needs_review", "Needs review"],
      ["changes_requested", "changes_requested", "Changes requested"],
      ["approved", "approved", "Approved"],
      ["approved_with_exceptions", "approved", "Approved"],
      ["rejected", null, "Rejected"],
      ["withdrawn", null, "Withdrawn"],
      ["draft", null, "Draft"],
      ["something_new", null, "Draft"],
    ];
    for (const [status, tab, word] of table) {
      expect([status, tabForStatus(status), statusWord(status)]).toEqual([status, tab, word]);
    }
  });
});

const life = (over: Partial<Lifecycle>): Lifecycle => ({
  status: "approved",
  liveAt: "2026-11-01T00:00:00Z",
  expiresAt: null,
  archivedAt: null,
  ...over,
});

describe("isLive", () => {
  test("an approved ad marked live with no end date", () => {
    expect(isLive(life({}), NOW)).toBe(true);
    expect(isLive(life({ status: "approved_with_exceptions" }), NOW)).toBe(true);
  });

  test("never live when not marked live, archived, or no longer approved", () => {
    expect(isLive(life({ liveAt: null }), NOW)).toBe(false);
    expect(isLive(life({ archivedAt: "2026-11-05T00:00:00Z" }), NOW)).toBe(false);
    expect(isLive(life({ status: "re_review_due" }), NOW)).toBe(false);
    expect(isLive(life({ status: "changes_requested" }), NOW)).toBe(false);
  });

  test("the end date ends it, inclusive of the exact moment", () => {
    expect(isLive(life({ expiresAt: "2026-11-08T00:00:00Z" }), NOW)).toBe(true);
    expect(isLive(life({ expiresAt: new Date(NOW).toISOString() }), NOW)).toBe(false);
    expect(isLive(life({ expiresAt: "2026-11-06T00:00:00Z" }), NOW)).toBe(false);
  });
});

describe("tabForAsset", () => {
  test("archived wins over everything", () => {
    expect(tabForAsset(life({ archivedAt: "2026-11-05T00:00:00Z" }), NOW)).toBe("archived");
    expect(tabForAsset(life({ status: "rejected", liveAt: null, archivedAt: "2026-11-05T00:00:00Z" }), NOW)).toBe("archived");
  });

  test("a live ad sits in Live, not Approved", () => {
    expect(tabForAsset(life({}), NOW)).toBe("live");
  });

  test("once expired or never marked live, an approved ad is back in Approved", () => {
    expect(tabForAsset(life({ expiresAt: "2026-11-06T00:00:00Z" }), NOW)).toBe("approved");
    expect(tabForAsset(life({ liveAt: null }), NOW)).toBe("approved");
  });

  test("otherwise the status decides", () => {
    expect(tabForAsset(life({ status: "re_review_due" }), NOW)).toBe("needs_review");
    expect(tabForAsset(life({ status: "changes_requested", liveAt: null }), NOW)).toBe("changes_requested");
    expect(tabForAsset(life({ status: "rejected", liveAt: null }), NOW)).toBeNull();
  });
});

describe("channels", () => {
  test("channelLabel: known labels, free text tidied, blanks read as unknown", () => {
    expect(channelLabel("paid_social")).toBe("Paid social");
    expect(channelLabel("direct_mail")).toBe("Direct mail");
    expect(channelLabel("tv-spot")).toBe("Tv spot");
    expect(channelLabel(null)).toBe("Channel unknown");
    expect(channelLabel("")).toBe("Channel unknown");
    expect(channelLabel("--")).toBe("Channel unknown");
  });

  test("liveChannelLabel: same tidying, blank when unknown", () => {
    expect(liveChannelLabel("linkedin")).toBe("LinkedIn");
    expect(liveChannelLabel("sms")).toBe("SMS");
    expect(liveChannelLabel("tv-spot")).toBe("Tv spot");
    expect(liveChannelLabel(undefined)).toBe("");
    expect(liveChannelLabel("__")).toBe("");
  });

  test("normaliseChannel: known options, then keyword families, else kept", () => {
    expect(normaliseChannel("Paid Social")).toBe("paid_social");
    expect(normaliseChannel("landing-page")).toBe("landing_page");
    expect(normaliseChannel("Facebook Ads")).toBe("paid_social");
    expect(normaliseChannel("Google Ads")).toBe("search");
    expect(normaliseChannel("Email newsletter")).toBe("email");
    expect(normaliseChannel("Text message")).toBe("sms");
    expect(normaliseChannel("Banner")).toBe("display");
    expect(normaliseChannel("Radio")).toBe("radio");
    expect(normaliseChannel(null)).toBeNull();
    expect(normaliseChannel("")).toBeNull();
  });

  test("keyword families match substrings, first family wins", () => {
    // BUG: a web banner is display advertising, but "web" (landing page family) is tested before "banner".
    expect(normaliseChannel("Web banner")).toBe("landing_page");
    // BUG: "postcard" contains "post" (affiliate family: blog/post), so a mailer reads as affiliate.
    expect(normaliseChannel("Postcard")).toBe("affiliate");
  });
});
