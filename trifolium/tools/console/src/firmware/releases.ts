// The released firmware, as the published site lists it. GitHub does not let a page download a
// release's files, so the release workflow copies each .uf2 onto the site beside a list of them,
// and this reads that list.

export interface FirmwareRelease {
  /** MAJOR.MINOR.PATCH, as the firmware reports it. */
  version: string;
  tag: string;
  /** The .uf2's path relative to the site's firmware/ folder. */
  file: string;
  size: number;
  sha256: string;
  /** ISO 8601. */
  published: string;
}

const VERSION = /^\d+\.\d+\.\d+$/;
const SHA256 = /^[0-9a-f]{64}$/;

export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

function isRelease(x: unknown): x is FirmwareRelease {
  const r = x as Partial<FirmwareRelease> | null;
  return (
    typeof r === "object" &&
    r !== null &&
    typeof r.version === "string" &&
    VERSION.test(r.version) &&
    typeof r.tag === "string" &&
    typeof r.file === "string" &&
    r.file.endsWith(".uf2") &&
    !r.file.includes("..") &&
    typeof r.size === "number" &&
    r.size > 0 &&
    typeof r.sha256 === "string" &&
    SHA256.test(r.sha256) &&
    typeof r.published === "string"
  );
}

/** The usable entries of a releases.json, newest first. An entry it cannot use is left out. */
export function parseReleaseList(json: unknown): FirmwareRelease[] {
  const releases = (json as { releases?: unknown } | null)?.releases;
  if (!Array.isArray(releases)) throw new Error("That is not a release list.");
  return releases.filter(isRelease).sort((a, b) => compareVersions(b.version, a.version));
}

async function get(url: string, fetchImpl: typeof fetch): Promise<Response> {
  let response: Response;
  try {
    response = await fetchImpl(url, { cache: "no-cache" });
  } catch {
    throw new Error("Could not reach the release list - offline, or the site is down.");
  }
  if (!response.ok) throw new Error(`The release list answered ${response.status}.`);
  return response;
}

export async function fetchReleaseList(
  siteUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FirmwareRelease[]> {
  const response = await get(`${siteUrl}firmware/releases.json`, fetchImpl);
  return parseReleaseList(await response.json());
}

export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The release's .uf2, refused unless it is exactly the file the list describes. */
export async function fetchRelease(
  siteUrl: string,
  release: FirmwareRelease,
  fetchImpl: typeof fetch = fetch,
): Promise<Uint8Array<ArrayBuffer>> {
  const response = await get(`${siteUrl}firmware/${release.file}`, fetchImpl);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length !== release.size) {
    throw new Error(
      `v${release.version} arrived at the wrong size (${bytes.length} bytes, expected ${release.size}).`,
    );
  }
  if ((await sha256Hex(bytes)) !== release.sha256) {
    throw new Error(`v${release.version} failed its checksum - not the file the release list describes.`);
  }
  return bytes;
}
