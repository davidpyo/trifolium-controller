// The parts, drawn as small pictures of themselves rather than as schematic symbols: a lever
// microswitch, a tactile button, an ESC in its heat-shrink with its motor, a LiPo with its XT30.
//
// Physical colours, the same in both themes - a part is the colour it is. Only the label beside it
// follows the theme. Each picture is drawn into the body box the layout gave it and puts its legs
// on the side the layout says the board is.

import type { Theme } from "@mui/material/styles";
import { labelAbove, LEG, type Placed } from "./layout";
import type { PartKind } from "./model";

const BODY_DARK = "#26282b";
const BODY_EDGE = "#4a4d52";
const METAL = "#b8bcc2";
const METAL_DARK = "#8a9099";
const ON_DARK = "#e6e6e6";
const ON_LIGHT = "#2b2d30";
/** Parts with a light body, whose leg names need dark ink. */
const LIGHT_BODIES: PartKind[] = ["solenoid", "plug"];

interface ArtProps {
  placed: Placed;
  theme: Theme;
}

/** The legs, each from the body's edge to where its wire starts, and the name the part marks it with. */
function Legs({ placed }: { placed: Placed }) {
  const { part, terminals } = placed;
  return (
    <g>
      {part.leads.map((lead) => {
        const t = terminals.get(lead.id);
        if (!t) return null;
        const bx = t.x - t.dx * LEG;
        const by = t.y - t.dy * LEG;
        // The leg's name sits just inside the body, beside where the leg leaves it.
        const inset = 4;
        const lx = bx - t.dx * inset;
        const ly = by - t.dy * inset;
        const anchor = t.dx > 0 ? "end" : t.dx < 0 ? "start" : "middle";
        return (
          <g key={lead.id}>
            <line x1={bx} y1={by} x2={t.x} y2={t.y} stroke={METAL} strokeWidth={2.2} strokeLinecap="round" />
            {/* A battery's leads come out of its XT30, which says which is which. */}
            {lead.leg && lead.edge === "board" && part.kind !== "battery" && (
              <text
                x={lx}
                y={t.dy ? ly + (t.dy < 0 ? 7 : -2) : ly + 3}
                textAnchor={anchor}
                fontSize={8}
                fontWeight={600}
                fill={LIGHT_BODIES.includes(part.kind) ? ON_LIGHT : ON_DARK}
                style={{ pointerEvents: "none" }}
              >
                {lead.leg}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

function Label({ placed, theme }: ArtProps) {
  const { part, x, y, w, h, facing } = placed;
  const cx = x + w / 2;
  const top = labelAbove(part);
  // A microswitch in the bottom row has its lever underneath, which its label goes below.
  const textY = top ? y - 6 : y + h + 15 + (part.kind === "microswitch" && facing === "up" ? 12 : 0);
  // A label on top starts just past the power leads, which leave from the near end, and reads
  // away from the board - so the leads dropping from the parts above never cross it.
  const tx = top ? (facing === "right" ? x + w - 26 : x + 26) : cx;
  const anchor = top ? (facing === "right" ? "end" : "start") : "middle";
  return (
    <text
      x={tx}
      y={textY}
      textAnchor={anchor}
      fontSize={12}
      fontWeight={600}
      fill={theme.palette.text.primary}
      // A halo in the page's colour, so a wire passing behind the part does not strike through it.
      stroke={theme.palette.background.paper}
      strokeWidth={3}
      strokeLinejoin="round"
      paintOrder="stroke"
      style={{ pointerEvents: "none" }}
    >
      {part.label}
      {part.note && top && (
        <tspan fontWeight={400} fill={theme.palette.text.secondary}>
          {" "}
          · {part.note}
        </tspan>
      )}
      {part.note && !top && (
        <tspan x={cx} dy={13} fontSize={10.5} fontWeight={400} fill={theme.palette.text.secondary}>
          {part.note}
        </tspan>
      )}
    </text>
  );
}

function Solenoid({ x, y, w, h, plunger }: { x: number; y: number; w: number; h: number; plunger: "left" | "right" }) {
  const bands = [0.2, 0.4, 0.6, 0.8].map((f) => x + w * f);
  const px = plunger === "right" ? x + w : x - 22;
  return (
    <g>
      <rect x={px} y={y + h * 0.3} width={22} height={h * 0.4} rx={2} fill={METAL_DARK} />
      <rect x={x} y={y} width={w} height={h} rx={4} fill={METAL} stroke={METAL_DARK} />
      {bands.map((bx) => (
        <line key={bx} x1={bx} y1={y} x2={bx} y2={y + h} stroke={METAL_DARK} strokeWidth={1.5} />
      ))}
    </g>
  );
}

function Motor({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={22} fill="#8d949c" stroke="#5f666e" strokeWidth={1.5} />
      {[0, 60, 120].map((a) => (
        <line
          key={a}
          x1={cx + 11 * Math.cos((a * Math.PI) / 180)}
          y1={cy + 11 * Math.sin((a * Math.PI) / 180)}
          x2={cx - 11 * Math.cos((a * Math.PI) / 180)}
          y2={cy - 11 * Math.sin((a * Math.PI) / 180)}
          stroke="#6b7279"
          strokeWidth={2}
        />
      ))}
      <circle cx={cx} cy={cy} r={6} fill="#3a3f45" />
    </g>
  );
}

function Body({ placed }: { placed: Placed }) {
  const { part, x, y, w, h, facing } = placed;
  // Which end of the body is away from the board, where a motor or a solenoid hangs off it.
  const outward = facing === "right" ? -1 : 1;
  const outerEdge = facing === "right" ? x : x + w;

  switch (part.kind) {
    case "microswitch": {
      // The lever is hinged at the far end, with its roller at the tip. It is on the face opposite
      // the legs: on top beside the board, underneath in the row below it where the legs go up.
      const hinge = facing === "left" ? x + w - 6 : x + 6;
      const tip = facing === "left" ? x + 4 : x + w - 4;
      const face = facing === "up" ? y + h + 1 : y - 1;
      const reach = facing === "up" ? 9 : -9;
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} rx={3} fill={BODY_DARK} stroke={BODY_EDGE} />
          <line x1={hinge} y1={face} x2={tip} y2={face + reach} stroke={METAL} strokeWidth={2.5} strokeLinecap="round" />
          <circle cx={tip} cy={face + reach} r={2.5} fill={METAL_DARK} />
          <circle cx={x + w * 0.3} cy={y + h / 2} r={2.6} fill="#111" />
          <circle cx={x + w * 0.62} cy={y + h / 2} r={2.6} fill="#111" />
        </g>
      );
    }
    case "button":
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} rx={3} fill={BODY_DARK} stroke={BODY_EDGE} />
          <circle cx={x + w / 2} cy={y + h / 2} r={w * 0.28} fill="#d0d3d8" stroke="#9aa0a6" />
        </g>
      );
    case "selector": {
      const cx = x + w / 2;
      const cy = y + h / 2;
      return (
        <g>
          <circle cx={cx} cy={cy} r={w / 2} fill={BODY_DARK} stroke={BODY_EDGE} />
          {[-50, 0, 50].map((a) => (
            <line
              key={a}
              x1={cx + (w / 2 - 2) * Math.sin((a * Math.PI) / 180)}
              y1={cy - (w / 2 - 2) * Math.cos((a * Math.PI) / 180)}
              x2={cx + (w / 2 - 6) * Math.sin((a * Math.PI) / 180)}
              y2={cy - (w / 2 - 6) * Math.cos((a * Math.PI) / 180)}
              stroke={METAL}
              strokeWidth={1.5}
            />
          ))}
          <circle cx={cx} cy={cy} r={w * 0.28} fill="#3a3d42" stroke={METAL_DARK} />
          <line x1={cx} y1={cy} x2={cx} y2={cy - w * 0.26} stroke={ON_DARK} strokeWidth={2.2} strokeLinecap="round" />
        </g>
      );
    }
    case "pot": {
      const cx = x + w / 2;
      const cy = y + h / 2;
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} rx={4} fill="#2f5d8f" stroke="#244a72" />
          <circle cx={cx} cy={cy} r={w * 0.36} fill="#9aa0a6" stroke="#6b7279" />
          <line x1={cx} y1={cy} x2={cx + w * 0.22} y2={cy - w * 0.22} stroke="#2b2d30" strokeWidth={2.5} strokeLinecap="round" />
        </g>
      );
    }
    case "oled": {
      // The screen sits away from the header, which carries the pin names.
      const sx = facing === "left" ? x + 26 : x + 6;
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} rx={4} fill="#1f4ea8" stroke="#163c82" />
          <rect x={sx} y={y + 7} width={w - 32} height={h - 14} rx={2} fill="#0b0b0b" />
          {[0, 1, 2].map((i) => (
            <rect key={i} x={sx + 5} y={y + 13 + i * 9} width={(w - 44) * (1 - i * 0.25)} height={4} rx={1} fill="#6fd3ff" opacity={0.8} />
          ))}
        </g>
      );
    }
    case "esc": {
      const motorX = outerEdge + outward * 42;
      const cy = y + h / 2;
      return (
        <g>
          {[-6, 0, 6].map((d, i) => (
            <line
              key={d}
              x1={outerEdge}
              y1={cy + d}
              x2={motorX - outward * 20}
              y2={cy + d * 0.6}
              stroke={["#3a3a3a", "#5a5a5a", "#7a7a7a"][i]}
              strokeWidth={2.5}
              strokeLinecap="round"
            />
          ))}
          <rect x={x} y={y} width={w} height={h} rx={7} fill="#2f6fd6" stroke="#2356a8" />
          <rect x={x + 6} y={y + 5} width={w - 12} height={4} rx={2} fill="#ffffff" opacity={0.18} />
          <Motor cx={motorX} cy={cy} />
        </g>
      );
    }
    case "solenoid":
      return <Solenoid x={x} y={y} w={w} h={h} plunger={facing === "right" ? "left" : "right"} />;
    case "driver": {
      // A MOSFET board with its screw terminal, and the solenoid it switches hanging off the far side.
      const solW = 70;
      const solH = 24;
      const solX = facing === "right" ? x - 30 - solW : x + w + 30;
      const solY = y + (h - solH) / 2;
      const near = facing === "right" ? solX + solW : solX;
      return (
        <g>
          <path
            d={`M ${outerEdge} ${y + h / 2 - 5} L ${near} ${solY + 6}`}
            stroke="#d7263d"
            strokeWidth={2.5}
            fill="none"
          />
          <path
            d={`M ${outerEdge} ${y + h / 2 + 5} L ${near} ${solY + solH - 6}`}
            stroke="#1c1c1c"
            strokeWidth={2.5}
            fill="none"
          />
          <rect x={x} y={y} width={w} height={h} rx={3} fill="#2a7d4f" stroke="#1f5e3b" />
          <rect x={x + w / 2 - 9} y={y + 5} width={18} height={14} rx={1.5} fill="#151515" />
          <rect x={x + w / 2 - 12} y={y + h - 11} width={24} height={8} rx={1.5} fill="#1d6fb8" />
          <Solenoid x={solX} y={solY} w={solW} h={solH} plunger={facing === "right" ? "left" : "right"} />
        </g>
      );
    }
    case "led": {
      const cx = x + w / 2;
      return (
        <g>
          <rect x={x + 2} y={y + h - 8} width={w - 4} height={6} rx={1.5} fill="#c0392b" />
          <path
            d={`M ${x + 4} ${y + h - 8} V ${y + 10} A ${w / 2 - 4} ${w / 2 - 4} 0 0 1 ${x + w - 4} ${y + 10} V ${y + h - 8} Z`}
            fill="#ff5a4f"
            opacity={0.9}
          />
          <ellipse cx={cx - 3} cy={y + 9} rx={2.5} ry={4} fill="#ffffff" opacity={0.45} />
        </g>
      );
    }
    case "battery":
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} rx={6} fill="#2a2c2f" stroke="#45484d" />
          <rect x={x + 10} y={y + 10} width={w - 20} height={h - 20} rx={3} fill="#3b3e43" />
          {/* The XT30, on the edge the leads leave from. */}
          <rect x={x + w / 2 - 13} y={y - 7} width={26} height={12} rx={2.5} fill="#e8c21a" stroke="#b8960f" />
          <text x={x + w / 2} y={y + h / 2 + 4} textAnchor="middle" fontSize={11} fontWeight={600} fill={ON_DARK} style={{ pointerEvents: "none" }}>
            {part.note ?? "LiPo"}
          </text>
        </g>
      );
    case "plug":
      return (
        <g>
          <rect x={x} y={y} width={w} height={h} rx={2} fill="#e9e5da" stroke="#b9b4a6" />
          <rect x={x + w / 2 - 4} y={y + h / 2 - 4} width={8} height={8} rx={1} fill="#6b6658" />
        </g>
      );
  }
}

export function PartArt({ placed, theme }: ArtProps) {
  return (
    <g>
      <Body placed={placed} />
      <Legs placed={placed} />
      {/* A battery shows its type on its own sticker, so its label need not repeat it. */}
      <Label placed={placed.part.kind === "battery" ? { ...placed, part: { ...placed.part, note: undefined } } : placed} theme={theme} />
    </g>
  );
}
