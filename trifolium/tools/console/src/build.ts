/** Set by vite.config.ts at build time. */
declare const __BUILD__: {
  commit: string;
  date: string;
  siteUrl: string;
  repoUrl: string;
};

/**
 * Where this copy of the console came from: the commit and day it was built, the published site
 * (with a trailing slash) that serves the latest console and the released firmware, and the
 * repository.
 */
export const BUILD = __BUILD__;

/** The published offline copy - the same page as the site's own, under a name that says what it is. */
export const OFFLINE_FILE = "trifolium-console.html";

/** Whether this copy is the one the site serves, rather than a saved file or a dev server. */
export function servedFromSite(href: string = window.location.href): boolean {
  return BUILD.siteUrl !== "" && href.startsWith(BUILD.siteUrl);
}

/**
 * Whether the site's console is newer than this copy, going by the commit the site says it was
 * built from. The site only moves forward, so a published copy that differs from it is older. A
 * local build is neither, and the site's own page is the site.
 */
export function siteIsNewer(
  published: { commit?: unknown } | null,
  build: { commit: string } = BUILD,
  onSite: boolean = servedFromSite(),
): boolean {
  if (onSite || build.commit.endsWith("-local")) return false;
  if (typeof published?.commit !== "string" || published.commit === "") return false;
  return !published.commit.startsWith(build.commit);
}
