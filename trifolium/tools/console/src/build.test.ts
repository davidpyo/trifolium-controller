import { describe, expect, it } from "vitest";
import { BUILD, servedFromSite, siteIsNewer } from "./build";

const saved = { commit: "56a2594" };

describe("the build stamp", () => {
  it("is baked in at build time", () => {
    expect(BUILD.commit).toMatch(/^[0-9a-f]{7}(-local)?$|^unknown-local$/);
    expect(BUILD.siteUrl.endsWith("/")).toBe(true);
  });

  it("knows the site's own page from a saved copy", () => {
    expect(servedFromSite(`${BUILD.siteUrl}index.html`)).toBe(true);
    expect(servedFromSite("file:///C:/Users/me/trifolium-console.html")).toBe(false);
  });
});

describe("a newer console on the site", () => {
  it("is one built from a different commit than a saved copy", () => {
    expect(siteIsNewer({ commit: "7fc40c0e1f2a" }, saved, false)).toBe(true);
    expect(siteIsNewer({ commit: "56a2594e1f2a" }, saved, false)).toBe(false);
  });

  it("is never claimed by the site's own page or a local build", () => {
    expect(siteIsNewer({ commit: "7fc40c0" }, saved, true)).toBe(false);
    expect(siteIsNewer({ commit: "7fc40c0" }, { commit: "56a2594-local" }, false)).toBe(false);
  });

  it("is not claimed from an answer without a commit", () => {
    expect(siteIsNewer(null, saved, false)).toBe(false);
    expect(siteIsNewer({ commit: "" }, saved, false)).toBe(false);
    expect(siteIsNewer({ commit: 42 }, saved, false)).toBe(false);
  });
});
