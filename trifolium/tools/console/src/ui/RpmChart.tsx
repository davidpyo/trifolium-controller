import React from "react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import { extentOf, niceStep } from "../rpm/parse";

export interface Series {
  name: string;
  colour: string;
  values: number[];
  dash?: string;
  /** Scaled against its own extent and labelled on the right, for signals the left axis crushes. */
  axis?: "left" | "right";
}

const PAD = { top: 8, right: 46, bottom: 22, left: 52 };

/**
 * One combined line chart, drawn as SVG.
 *
 * Two y-axes rather than one because throttle (0-2000) and RPM (0-45000) on a shared axis reduce
 * throttle to a flat line at the bottom. Series on the left axis still squash each other; the hover
 * readout gives exact values regardless of how small a line looks.
 */
export function RpmChart({
  series,
  height = 260,
  xLabel = "sample (≈ms)",
}: {
  series: Series[];
  height?: number;
  xLabel?: string;
}) {
  const theme = useTheme();
  const [hover, setHover] = React.useState<number | null>(null);
  const [width, setWidth] = React.useState(720);
  const hostRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const el = hostRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const left = series.filter((s) => s.axis !== "right");
  const right = series.filter((s) => s.axis === "right");
  const sampleCount = Math.max(0, ...series.map((s) => s.values.length));

  if (!series.length || sampleCount === 0) {
    return (
      <Typography variant="caption" color="text.secondary">
        Nothing to chart.
      </Typography>
    );
  }

  const plotW = Math.max(80, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;

  const leftExtent = extentOf(left.map((s) => s.values));
  const rightExtent = extentOf(right.map((s) => s.values));

  const x = (i: number) => PAD.left + (sampleCount <= 1 ? 0 : (i / (sampleCount - 1)) * plotW);
  const yFor = (v: number, e: { min: number; max: number }) =>
    PAD.top + plotH - ((v - e.min) / (e.max - e.min || 1)) * plotH;

  const path = (s: Series) => {
    const e = s.axis === "right" ? rightExtent : leftExtent;
    let d = "";
    let penDown = false;
    s.values.forEach((v, i) => {
      if (!Number.isFinite(v)) {
        penDown = false;
        return;
      }
      d += `${penDown ? "L" : "M"}${x(i).toFixed(1)} ${yFor(v, e).toFixed(1)} `;
      penDown = true;
    });
    return d;
  };

  const ticks = (e: { min: number; max: number }) => {
    const step = niceStep(e.max - e.min, 5);
    const first = Math.ceil(e.min / step) * step;
    const out: number[] = [];
    for (let v = first; v <= e.max; v += step) out.push(v);
    return out;
  };

  const grid = theme.palette.divider;
  const axisText = theme.palette.text.secondary;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left - PAD.left;
    if (px < 0 || px > plotW) return setHover(null);
    const i = Math.round((px / plotW) * (sampleCount - 1));
    setHover(Math.min(sampleCount - 1, Math.max(0, i)));
  };

  return (
    <Box ref={hostRef} sx={{ width: "100%" }}>
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        style={{ display: "block", touchAction: "none" }}
      >
        {ticks(leftExtent).map((v) => {
          const y = yFor(v, leftExtent);
          return (
            <g key={`l${v}`}>
              <line x1={PAD.left} x2={PAD.left + plotW} y1={y} y2={y} stroke={grid} strokeWidth={1} />
              <text x={PAD.left - 6} y={y + 3} textAnchor="end" fontSize={10} fill={axisText}>
                {Math.round(v)}
              </text>
            </g>
          );
        })}

        {right.length > 0 &&
          ticks(rightExtent).map((v) => (
            <text
              key={`r${v}`}
              x={PAD.left + plotW + 6}
              y={yFor(v, rightExtent) + 3}
              fontSize={10}
              fill={axisText}
            >
              {Math.round(v)}
            </text>
          ))}

        <line
          x1={PAD.left}
          x2={PAD.left + plotW}
          y1={PAD.top + plotH}
          y2={PAD.top + plotH}
          stroke={axisText}
        />
        <text
          x={PAD.left + plotW / 2}
          y={height - 4}
          textAnchor="middle"
          fontSize={10}
          fill={axisText}
        >
          {xLabel}
        </text>

        {series.map((s) => (
          <path
            key={s.name}
            d={path(s)}
            fill="none"
            stroke={s.colour}
            strokeWidth={1.4}
            strokeDasharray={s.dash}
          />
        ))}

        {hover !== null && (
          <line
            x1={x(hover)}
            x2={x(hover)}
            y1={PAD.top}
            y2={PAD.top + plotH}
            stroke={axisText}
            strokeDasharray="2 2"
          />
        )}
      </svg>

      <Stack direction="row" spacing={1.5} sx={{ flexWrap: "wrap", mt: 0.5 }}>
        {series.map((s) => (
          <Stack key={s.name} direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
            <Box sx={{ width: 14, height: 2, bgcolor: s.colour, flexShrink: 0 }} />
            <Typography sx={{ fontSize: 11 }} color="text.secondary">
              {s.name}
              {hover !== null && Number.isFinite(s.values[hover])
                ? `: ${Math.round(s.values[hover])}`
                : ""}
              {s.axis === "right" ? " (right)" : ""}
            </Typography>
          </Stack>
        ))}
        {hover !== null && (
          <Typography sx={{ fontSize: 11 }} color="text.disabled">
            sample {hover}
          </Typography>
        )}
      </Stack>
    </Box>
  );
}
