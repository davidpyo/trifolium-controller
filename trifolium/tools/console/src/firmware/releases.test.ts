import { describe, expect, it } from "vitest";
import {
  compareVersions,
  fetchRelease,
  fetchReleaseList,
  parseReleaseList,
  sha256Hex,
  type FirmwareRelease,
} from "./releases";

const SITE = "https://example.test/trifolium/";

const bytes = new Uint8Array([1, 2, 3, 4, 5]);

async function entry(overrides: Partial<FirmwareRelease> = {}): Promise<FirmwareRelease> {
  return {
    version: "2.1.0",
    tag: "v2.1.0",
    file: "v2.1.0/firmware.uf2",
    size: bytes.length,
    sha256: await sha256Hex(bytes),
    published: "2026-09-25T01:08:46Z",
    ...overrides,
  };
}

/** A fetch that answers from a table of URLs, and 404s the rest. */
function fakeFetch(table: Record<string, unknown>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (!(url in table)) return new Response("missing", { status: 404 });
    const body = table[url];
    return body instanceof Uint8Array
      ? new Response(body as Uint8Array<ArrayBuffer>)
      : new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

describe("versions", () => {
  it("compares each part as a number", () => {
    expect(compareVersions("2.10.0", "2.9.1")).toBeGreaterThan(0);
    expect(compareVersions("2.1.0", "2.1.0")).toBe(0);
    expect(compareVersions("1.9.9", "2.0.0")).toBeLessThan(0);
  });
});

describe("the release list", () => {
  it("lists every well-formed release, newest first", async () => {
    const list = parseReleaseList({
      releases: [
        await entry({ version: "2.1.0", tag: "v2.1.0" }),
        await entry({ version: "2.10.0", tag: "v2.10.0" }),
        await entry({ version: "2.2.0", tag: "v2.2.0" }),
      ],
    });
    expect(list.map((r) => r.version)).toEqual(["2.10.0", "2.2.0", "2.1.0"]);
  });

  it("drops an entry it cannot use rather than the whole list", async () => {
    const good = await entry();
    const list = parseReleaseList({
      releases: [good, { version: "2.2.0" }, { ...good, version: "2.3", tag: "v2.3" }, "junk"],
    });
    expect(list).toEqual([good]);
  });

  it("refuses something that is not a release list", () => {
    expect(() => parseReleaseList({ nope: [] })).toThrow(/release list/);
    expect(() => parseReleaseList(null)).toThrow(/release list/);
  });

  it("is fetched from the site's firmware folder", async () => {
    const good = await entry();
    const list = await fetchReleaseList(SITE, fakeFetch({ [`${SITE}firmware/releases.json`]: { releases: [good] } }));
    expect(list).toEqual([good]);
  });

  it("says so when the site cannot be reached or has no list", async () => {
    await expect(fetchReleaseList(SITE, fakeFetch({}))).rejects.toThrow(/404/);
    const offline = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    await expect(fetchReleaseList(SITE, offline)).rejects.toThrow(/could not reach/i);
  });
});

describe("a release's firmware", () => {
  it("arrives when its size and checksum match the list", async () => {
    const release = await entry();
    const got = await fetchRelease(SITE, release, fakeFetch({ [`${SITE}firmware/${release.file}`]: bytes }));
    expect(Array.from(got)).toEqual(Array.from(bytes));
  });

  it("is refused when it does not match the list", async () => {
    const release = await entry();
    const url = `${SITE}firmware/${release.file}`;
    const tampered = new Uint8Array([1, 2, 3, 4, 6]);
    await expect(fetchRelease(SITE, release, fakeFetch({ [url]: tampered }))).rejects.toThrow(
      /checksum/,
    );
    const short = new Uint8Array([1, 2, 3]);
    await expect(fetchRelease(SITE, release, fakeFetch({ [url]: short }))).rejects.toThrow(/size/);
  });
});
