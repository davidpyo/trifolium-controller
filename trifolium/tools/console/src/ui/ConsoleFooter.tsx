import React from "react";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { BUILD, OFFLINE_FILE, servedFromSite, siteIsNewer } from "../build";

interface PublishedBuild {
  commit: string;
  date: string;
}

/**
 * Which build of the console this is, where to get it for offline use, and - for a saved copy
 * that can reach the site - whether the site has a newer one.
 */
export function ConsoleFooter() {
  const onSite = servedFromSite();
  const [newer, setNewer] = React.useState<PublishedBuild | null>(null);

  React.useEffect(() => {
    if (onSite || BUILD.commit.endsWith("-local")) return; // nothing to compare against
    let current = true;
    fetch(`${BUILD.siteUrl}console.json`, { cache: "no-cache" })
      .then((r) => (r.ok ? (r.json() as Promise<PublishedBuild>) : null))
      .then((published) => {
        if (current && published && siteIsNewer(published, BUILD, onSite)) setNewer(published);
      })
      .catch(() => {}); // offline: this copy is what there is
    return () => {
      current = false;
    };
  }, [onSite]);

  return (
    <Stack direction="row" spacing={1.5} sx={{ mt: 1.5, alignItems: "center", flexWrap: "wrap" }}>
      <Typography variant="caption" color="text.disabled">
        Trifolium Console · built from {BUILD.commit} on {BUILD.date}
      </Typography>
      {/* Same-origin on the site, so the browser saves it; from a saved copy it opens the page. */}
      <Link variant="caption" href={`${BUILD.siteUrl}${OFFLINE_FILE}`} download={OFFLINE_FILE}>
        Download for offline use
      </Link>
      <Link variant="caption" href={`${BUILD.repoUrl}/releases`} target="_blank" rel="noopener noreferrer">
        Firmware releases
      </Link>
      {newer && (
        <Typography variant="caption" color="warning.main">
          A newer console is on the site ({newer.commit.slice(0, 7)}, {newer.date}) -{" "}
          <Link href={BUILD.siteUrl} target="_blank" rel="noopener noreferrer">
            open it
          </Link>
          .
        </Typography>
      )}
    </Stack>
  );
}
