"""Assembles the published site: the console, its offline copy, and the released firmware.

    python tools/build_site.py --console tools/console/dist/index.html --out _site
    python tools/build_site.py --self-test

What lands in the output:

    index.html               the console, as the site serves it
    trifolium-console.html   the same page, as the offline download
    console.json             the commit and date the console was built from, so a saved copy can
                             tell the site has a newer one
    firmware/releases.json   every published release's firmware: version, file, size, SHA-256
    firmware/<tag>/<file>    each release's .uf2

GitHub does not let a web page download a release's files, so the console cannot fetch firmware
from a release directly. This copies each .uf2 onto the site, where it can. The copies are fetched
through the API, which needs GITHUB_REPOSITORY (owner/name) and GH_TOKEN - both set in Actions.
Drafts, pre-releases, tags that are not a MAJOR.MINOR.PATCH version, and releases without a .uf2 are
left out.
"""

import argparse
import datetime
import hashlib
import json
import os
import re
import shutil
import sys
import urllib.request

API = "https://api.github.com"
OFFLINE_FILE = "trifolium-console.html"
VERSION_TAG = re.compile(r"^v?(\d+\.\d+\.\d+)$")


def api(path, token, accept="application/vnd.github+json"):
    headers = {"Accept": accept, "User-Agent": "trifolium-build-site"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    with urllib.request.urlopen(urllib.request.Request(path, headers=headers), timeout=60) as r:
        return r.read()


def published_releases(repo, token):
    releases, page = [], 1
    while True:
        batch = json.loads(api(f"{API}/repos/{repo}/releases?per_page=100&page={page}", token))
        releases += batch
        if len(batch) < 100:
            return releases
        page += 1


def firmware_asset(release):
    """The release's .uf2, or None. A release carries one; if it ever carries several, the name
    sorts first."""
    uf2s = sorted((a for a in release.get("assets", []) if a["name"].endswith(".uf2")),
                  key=lambda a: a["name"])
    return uf2s[0] if uf2s else None


def listable(release):
    """The version a release publishes, or None if it is not one the console should offer."""
    if release.get("draft") or release.get("prerelease"):
        return None
    m = VERSION_TAG.match(release.get("tag_name", ""))
    if not m or not firmware_asset(release):
        return None
    return m.group(1)


def entry(release, version, data):
    asset = firmware_asset(release)
    return {
        "version": version,
        "tag": release["tag_name"],
        "file": f"{release['tag_name']}/{asset['name']}",
        "size": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "published": release.get("published_at") or "",
    }


def write_firmware(out, repo, token):
    firmware = os.path.join(out, "firmware")
    os.makedirs(firmware, exist_ok=True)
    entries = []
    for release in published_releases(repo, token):
        version = listable(release)
        if not version:
            continue
        asset = firmware_asset(release)
        data = api(asset["url"], token, accept="application/octet-stream")
        item = entry(release, version, data)
        path = os.path.join(firmware, *item["file"].split("/"))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(data)
        entries.append(item)
        print(f"  firmware {item['file']} ({item['size']} bytes)")
    with open(os.path.join(firmware, "releases.json"), "w", encoding="utf-8") as f:
        json.dump({"releases": entries}, f, indent=1)
    return entries


def write_console(out, console, commit, date):
    os.makedirs(out, exist_ok=True)
    shutil.copyfile(console, os.path.join(out, "index.html"))
    shutil.copyfile(console, os.path.join(out, OFFLINE_FILE))
    with open(os.path.join(out, "console.json"), "w", encoding="utf-8") as f:
        json.dump({"commit": commit, "date": date}, f)
    print(f"  console built from {commit[:7]} on {date}")


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--console", help="the built console page")
    parser.add_argument("--out", help="the directory to assemble the site in")
    parser.add_argument("--self-test", action="store_true",
                        help="check this script's own logic; fetches nothing")
    opts = parser.parse_args()

    if opts.self_test:
        self_test()
    if not opts.console or not opts.out:
        parser.error("--console and --out are required")

    repo = os.environ.get("GITHUB_REPOSITORY")
    if not repo:
        sys.exit("GITHUB_REPOSITORY (owner/name) is not set")
    commit = os.environ.get("TRIFOLIUM_BUILD_COMMIT") or os.environ.get("GITHUB_SHA") or "unknown"
    date = os.environ.get("TRIFOLIUM_BUILD_DATE") or datetime.date.today().isoformat()

    write_console(opts.out, opts.console, commit, date)
    entries = write_firmware(opts.out, repo, os.environ.get("GH_TOKEN"))
    print(f"site assembled in {opts.out}: {len(entries)} firmware release(s)")


# -------------------------------------------------------------------------------------------


def self_test():
    ok = True

    def expect(label, condition, detail=""):
        nonlocal ok
        if not condition:
            ok = False
        print(f"  [{'PASS' if condition else 'FAIL'}] {label}" + (f" - {detail}" if detail else ""))

    def release(tag, assets=("firmware.uf2",), **flags):
        return {"tag_name": tag, "published_at": "2026-09-25T01:08:46Z",
                "assets": [{"name": n, "url": f"https://api/{n}"} for n in assets], **flags}

    expect("a version tag is offered", listable(release("v2.1.0")) == "2.1.0")
    expect("a tag without its v is read the same", listable(release("2.1.0")) == "2.1.0")
    expect("a draft is left out", listable(release("v2.2.0", draft=True)) is None)
    expect("a pre-release is left out", listable(release("v2.2.0", prerelease=True)) is None)
    expect("a tag that is not a version is left out", listable(release("nightly")) is None)
    expect("a release without a .uf2 is left out",
           listable(release("v2.2.0", assets=("notes.txt",))) is None)
    expect("the .uf2 is picked from among other files",
           firmware_asset(release("v2.2.0", assets=("MANIFEST.txt", "trifolium-2.2.0-universal.uf2",
                                                    "SHA256SUMS.txt")))["name"]
           == "trifolium-2.2.0-universal.uf2")

    data = b"\x00\x01uf2"
    item = entry(release("v2.1.0"), "2.1.0", data)
    expect("an entry is filed under its tag", item["file"] == "v2.1.0/firmware.uf2", item["file"])
    expect("an entry carries the file's size and SHA-256",
           item["size"] == len(data) and item["sha256"] == hashlib.sha256(data).hexdigest())
    expect("an entry has every field the console checks",
           set(item) == {"version", "tag", "file", "size", "sha256", "published"}, str(sorted(item)))

    print("\nself-test " + ("passed" if ok else "FAILED"))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
