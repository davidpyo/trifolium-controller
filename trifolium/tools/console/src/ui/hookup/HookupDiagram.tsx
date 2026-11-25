import React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import type { Schema } from "../../schema/types";
import type { WiringDiagram } from "../../schema/wiringDiagrams";
import { labelsByField } from "../PinConflicts";
import { CROSS_GAP, layout, PAD_LABEL_FONT, placePadLabels, TAG_FONT, GROUND_COLOUR, SIGNAL_COLOURS, SUPPLY_COLOUR, type Layout, type Wire } from "./layout";
import { buildHookup, gpiosOf } from "./model";
import { readPads } from "./pads";
import { PartArt } from "./PartArt";
import { PIN_FONT, pinName, TEXT_IN, type Schematic } from "./schematic";

// The hookup view: the board, as a schematic block of its pins, with every part this configuration
// uses drawn around it, and a wire from each of the part's legs to the pin it goes on. Read-only, like the pin view beside it - it
// answers "what do I solder where", from the same settings the table edits.
//
// Supply wires are red and grounds black, always, because those are the two a builder must never
// swap. Signals take the other colours, one per wire, so neighbouring wires stay tellable apart.

export interface HookupDiagramProps {
  schema: Schema;
  device: unknown;
  /** The board's drawing, or undefined for a board with none - which then gets a plain one. */
  diagram?: WiringDiagram;
  /** A GPIO whose part to light, because its row in the wiring table is under the pointer. */
  highlightPin?: number | null;
  /** The GPIO of the part under the pointer, or null as it leaves, for the table to light its row. */
  onHoverPin?: (gpio: number | null) => void;
}

/** What a wire says on hover. */
export function wireTitle(view: Layout, wire: Wire): string {
  const part = view.parts.find((p) => p.part.id === wire.part)?.part;
  const lead = part?.leads.find((l) => l.id === wire.lead);
  const what = `${part?.label ?? wire.part}${lead?.leg ? ` ${lead.leg}` : ""}`;
  const target = lead?.target;
  const to =
    target?.kind === "pad"
      ? [
          target.pad.gpio !== null ? `GP${target.pad.gpio}` : (target.pad.label ?? target.pad.power),
          target.pad.connector,
        ]
          .filter(Boolean)
          .join(" · ")
      : target?.kind === "part"
        ? `${view.parts.find((p) => p.part.id === target.part)?.part.label ?? target.part} ${target.lead === "+" ? "+" : "−"}`
        : (target?.text ?? "");
  return `${what} → ${to}`;
}

export function HookupDiagram({
  schema,
  device,
  diagram,
  highlightPin = null,
  onHoverPin,
}: HookupDiagramProps) {
  const theme = useTheme();
  const dark = theme.palette.mode === "dark";
  const artRef = React.useRef<SVGGElement>(null);
  const maskId = `hookup-cross-${React.useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [hovered, setHovered] = React.useState<string | null>(null);

  const sheet = React.useMemo(() => (diagram ? readPads(diagram.svgMarkup) : undefined), [diagram]);
  const hookup = buildHookup(schema, device, sheet, diagram?.markers);
  const view = layout(hookup);
  const { board } = view;

  // The board's own art, injected for the same reason the pin view injects it: React would rebuild
  // a subtree it owned on every render. Sized to the box the layout gave the board.
  React.useLayoutEffect(() => {
    const host = artRef.current;
    if (!host) return;
    if (!diagram || hookup.generic) {
      host.innerHTML = "";
      return;
    }
    host.innerHTML = diagram.artMarkup;
    const svg = host.querySelector("svg");
    if (!svg) return;
    svg.setAttribute("x", String(board.x));
    svg.setAttribute("y", String(board.y));
    svg.setAttribute("width", String(board.w));
    svg.setAttribute("height", String(board.h));
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  }, [diagram, hookup.generic, board.x, board.y, board.w, board.h]);

  const lit = (partId: string) => {
    if (hovered) return hovered === partId;
    if (highlightPin === null) return true;
    const part = hookup.parts.find((p) => p.id === partId);
    return !!part && gpiosOf(part).includes(highlightPin);
  };
  const anyLit = hovered !== null || highlightPin !== null;
  const padLabels =
    anyLit && !view.schematic
      ? placePadLabels(
          view.pads.filter((p) =>
            view.wires.some((w) => lit(w.part) && w.land && w.land.x === p.sx && w.land.y === p.sy),
          ),
          board,
        )
      : [];

  const casing = (wire: Wire) =>
    wire.net === "gnd" ? (dark ? "#6f6f6f" : "#000000") : dark ? "rgba(0,0,0,0.65)" : "rgba(0,0,0,0.45)";

  const labels = labelsByField(schema);
  const internal = (diagram?.markers ?? []).filter((m) => m.wiredTo);
  const free = view.schematic ? freePins(view.schematic) : "";
  // Each part with a wire that has nowhere to go on this board, and what each such wire wanted.
  const missing = view.parts.flatMap(({ part }) => {
    const wants = part.leads.flatMap((l) => (l.target?.kind === "missing" ? [l.target.text.split(" — ")[0]] : []));
    return wants.length ? [`${part.label} (${wants.join(", ")})`] : [];
  });

  return (
    <Box sx={{ width: "100%", maxWidth: view.width }}>
      <Box
        component="svg"
        viewBox={`0 0 ${view.width.toFixed(1)} ${view.height.toFixed(1)}`}
        role="img"
        aria-label="Hookup diagram: each part and the pad each of its wires goes to"
        sx={{ width: "100%", height: "auto", display: "block" }}
      >
        <g transform={`translate(${view.offset.x.toFixed(1)} ${view.offset.y.toFixed(1)})`}>
          {/* The board's own drawing, faded so the wires and the pads they land on read over its
              detail. A board with none gets a block, drawn over the wires below. */}
          {!view.schematic && <g ref={artRef} opacity={dark ? 0.62 : 0.8} data-board="art" />}

          {/* The wires, under the parts so a leg covers the end of its wire. Grounds and supplies
              first, so a signal is never hidden under the power it runs beside. */}
          {/* Holes in the wires round the free pads they pass over, so a wire never seems to end
              on a pad it only crosses. */}
          <defs>
            <mask id={maskId} maskUnits="userSpaceOnUse" x={-view.offset.x} y={-view.offset.y} width={view.width} height={view.height}>
              <rect x={-view.offset.x} y={-view.offset.y} width={view.width} height={view.height} fill="white" />
              {view.pads
                .filter((p) => p.crossed)
                .map((p, i) => (
                  <circle key={i} cx={p.sx} cy={p.sy} r={CROSS_GAP} fill="black" />
                ))}
            </mask>
          </defs>
          <g fill="none" strokeLinecap="round" mask={`url(#${maskId})`}>
            {[...view.wires]
              .sort((a, b) => Number(a.net === "signal") - Number(b.net === "signal"))
              .map((wire) => {
                const on = lit(wire.part);
                return (
                  <g
                    key={wire.key}
                    opacity={anyLit && !on ? 0.18 : 1}
                    onMouseEnter={() => {
                      setHovered(wire.part);
                      onHoverPin?.(wire.gpio ?? null);
                    }}
                    onMouseLeave={() => {
                      setHovered(null);
                      onHoverPin?.(null);
                    }}
                  >
                    <title>{wireTitle(view, wire)}</title>
                    <path d={wire.d} stroke={casing(wire)} strokeWidth={on && anyLit ? 6.5 : 5} strokeDasharray={wire.missing ? "5 4" : undefined} />
                    <path
                      d={wire.d}
                      stroke={wire.colour}
                      strokeWidth={on && anyLit ? 4 : 3}
                      strokeDasharray={wire.missing ? "5 4" : undefined}
                      data-net={wire.net}
                      data-wire={wire.key}
                    />
                    {/* A fat invisible copy, so a 3px wire is not a 3px target. */}
                    <path d={wire.d} stroke="transparent" strokeWidth={12} />
                    {wire.missing && (
                      <text
                        x={wire.missing.x}
                        y={wire.missing.y - 1}
                        textAnchor={wire.missing.anchor}
                        fontSize={10}
                        fontWeight={600}
                        fill={theme.palette.warning.main}
                        stroke={theme.palette.background.paper}
                        strokeWidth={3}
                        strokeLinejoin="round"
                        paintOrder="stroke"
                      >
                        {wire.missing.short}
                      </text>
                    )}
                  </g>
                );
              })}
          </g>

          {/* Over the wires, so one to a pin on the far side passes behind the block, not over the
              names of the pins it crosses. */}
          {view.schematic && <Block schematic={view.schematic} />}

          {/* A free pad a wire passes over, ringed in the gap the wire leaves round it. */}
          {view.pads
            .filter((pad) => pad.crossed)
            .map((pad, i) => (
              <circle
                key={`x${i}`}
                cx={pad.sx}
                cy={pad.sy}
                r={2.4}
                fill="none"
                stroke="#9aa0a6"
                strokeWidth={1.1}
                data-crossed=""
                style={{ pointerEvents: "none" }}
              />
            ))}

          {/* Where each wire lands, over the wire's end. */}
          {view.pads
            .filter((pad) => pad.used)
            .map((pad, i) => (
              <circle
                key={i}
                cx={pad.sx}
                cy={pad.sy}
                r={3.4}
                fill="#f3d36b"
                stroke="#1b1d1f"
                strokeWidth={1.2}
                style={{ pointerEvents: "none" }}
              />
            ))}

          {/* The pads of whatever is pointed at - a part, a wire, a row of the table - named on the
              board beside them. Only those: named all at once, a tight row's names would crowd
              each other off their own pads and hide the board's print. */}
          <g style={{ pointerEvents: "none" }} data-pad-labels="">
            {padLabels.map((label, i) => (
              <g key={i}>
                {label.leader && (
                  <line
                    x1={label.pad.x}
                    y1={label.pad.y}
                    x2={label.leader.x}
                    y2={label.leader.y}
                    stroke="#f3d36b"
                    strokeWidth={0.8}
                  />
                )}
                <BoardLabel text={label.text} x={label.x} y={label.y} w={label.w} h={label.h} font={PAD_LABEL_FONT} />
              </g>
            ))}
          </g>

          {view.parts.map((placed) => {
            const gpios = gpiosOf(placed.part);
            return (
              <g
                key={placed.part.id}
                data-part={placed.part.id}
                opacity={anyLit && !lit(placed.part.id) ? 0.35 : 1}
                onMouseEnter={() => {
                  setHovered(placed.part.id);
                  onHoverPin?.(gpios[0] ?? null);
                }}
                onMouseLeave={() => {
                  setHovered(null);
                  onHoverPin?.(null);
                }}
                style={{ cursor: "default" }}
              >
                <title>
                  {placed.part.label}
                  {gpios.length ? ` — ${gpios.map((g) => `GP${g}`).join(", ")}` : ""}
                </title>
                <PartArt placed={placed} theme={theme} />
              </g>
            );
          })}

          {/* Each wire's pad, named where the wire meets the board - a name for the pad, not for
              the part's leg the wire leaves from - on a tag the wire's own colour, so the tag is
              plainly that wire's. */}
          <g style={{ pointerEvents: "none" }}>
            {view.wires.map((wire) =>
              wire.tag ? (
                <g key={wire.key} data-tag={wire.key} opacity={anyLit && !lit(wire.part) ? 0.18 : 1}>
                  <WireTag wire={wire} />
                </g>
              ) : null,
            )}
          </g>
        </g>
      </Box>

      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2, mt: 1, alignItems: "center" }}>
        {[
          { colour: SUPPLY_COLOUR, text: "Supply +" },
          { colour: GROUND_COLOUR, text: "Ground −" },
          { colour: SIGNAL_COLOURS[0], text: "Signal (any other colour)" },
        ].map(({ colour, text }) => (
          <Box key={text} sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
            <Box
              sx={{
                width: 22,
                height: 4,
                borderRadius: 2,
                bgcolor: colour,
                boxShadow: `0 0 0 1px ${dark ? "#6f6f6f" : "rgba(0,0,0,0.45)"}`,
              }}
            />
            <Typography variant="caption" color="text.secondary">
              {text}
            </Typography>
          </Box>
        ))}
      </Box>

      {missing.length > 0 && (
        <Typography variant="caption" color="warning.main" sx={{ display: "block", mt: 1 }}>
          A dashed wire has no pin for it on this board: {missing.join(", ")}.
        </Typography>
      )}
      {free && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
          Free, with nothing wired to them: {free}.
        </Typography>
      )}
      {internal.length > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
          Wired on the board, nothing to connect:{" "}
          {internal.map(({ gpio, wiredTo }) => `${labels.get(wiredTo!) ?? wiredTo} (GP${gpio})`).join(", ")}.
        </Typography>
      )}
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
        {hookup.generic
          ? "This board has no drawing, so its pins are shown grouped by the part each is for."
          : "Each wire's tag names the pad it goes on: by the board where there is room, else further along the wire. Point at a part to see its pads named on the board."}
      </Typography>
      <Typography variant="caption" color="text.disabled" sx={{ display: "block", mt: 1 }}>
        Read-only — edit in the table.
      </Typography>
    </Box>
  );
}

/**
 * The board: a box, its plugs out along its edges with their pins' names inside. Every pin of a plug
 * something is wired to is drawn, in its place, the free ones greyed; plugs with nothing wired to
 * them are listed under the drawing instead.
 */
function Block({ schematic }: { schematic: Schematic }) {
  const theme = useTheme();
  const { w, h, groups } = schematic;
  const ink = theme.palette.text.primary;
  const muted = theme.palette.text.secondary;
  const faint = theme.palette.text.disabled;
  return (
    <g data-board="schematic">
      {/* Solid, so the wires that pass behind it stay behind it. */}
      <rect x={0} y={0} width={w} height={h} rx={8} fill={theme.palette.background.paper} />
      <rect
        x={0}
        y={0}
        width={w}
        height={h}
        rx={8}
        fill={theme.palette.mode === "dark" ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.025)"}
        stroke={muted}
        strokeWidth={1.5}
      />
      {groups.map((g, gi) => {
        const bottom = g.side === "bottom";
        return (
          <g key={gi}>
            {g.name && (
              <>
                <rect x={g.x} y={g.y} width={g.w} height={g.h} rx={3} fill="none" stroke={theme.palette.divider} />
                <text
                  x={bottom ? g.x + g.w / 2 : g.side === "left" ? g.x + 4 : g.x + g.w - 4}
                  y={bottom ? g.y - 4 : g.y + 10}
                  textAnchor={bottom ? "middle" : g.side === "left" ? "start" : "end"}
                  fontSize={8}
                  letterSpacing={0.4}
                  fill={muted}
                >
                  {g.name.toUpperCase()}
                </text>
              </>
            )}
            {g.pins.map((pin, pi) => {
              // The point the pin leaves the box from, and where its name starts inside.
              const edge =
                pin.side === "left" ? { x: 0, y: pin.y } : pin.side === "right" ? { x: w, y: pin.y } : { x: pin.x, y: h };
              const tx = pin.side === "left" ? TEXT_IN : pin.side === "right" ? w - TEXT_IN : pin.x;
              const ty = pin.side === "bottom" ? h - TEXT_IN : pin.y;
              return (
                <g key={pi}>
                  <title>{[pin.text, pin.sub, pin.pad.connector].filter(Boolean).join(" · ")}</title>
                  <line x1={edge.x} y1={edge.y} x2={pin.x} y2={pin.y} stroke={muted} strokeWidth={1.5} />
                  {/* A free pin, drawn to keep the plug's pins in their places, and greyed. */}
                  {!pin.wired && (
                    <circle cx={pin.x} cy={pin.y} r={2.6} fill={theme.palette.background.paper} stroke={faint} strokeWidth={1.2} />
                  )}
                  <text
                    x={tx}
                    y={ty}
                    dy={3.3}
                    textAnchor={pin.side === "right" ? "end" : "start"}
                    transform={pin.side === "bottom" ? `rotate(-90 ${tx} ${ty})` : undefined}
                    fontSize={PIN_FONT}
                    fontWeight={pin.wired ? 600 : 400}
                    fill={pin.wired ? ink : faint}
                  >
                    {pin.text}
                    {pin.sub && (
                      <tspan fill={muted} fontWeight={400}>
                        {` ${pin.sub}`}
                      </tspan>
                    )}
                  </text>
                </g>
              );
            })}
          </g>
        );
      })}
    </g>
  );
}

/**
 * The pins the block leaves out, said plug by plug: a plug with nothing on it by its name alone,
 * one partly used by the pins still free on it.
 */
export function freePins({ free, pins }: Schematic): string {
  const used = new Set(pins.map((p) => p.pad.connector).filter(Boolean));
  const plugs = new Map<string, string[]>();
  const loose: string[] = [];
  for (const pad of free) {
    const { text } = pinName(pad);
    if (pad.connector) plugs.set(pad.connector, [...(plugs.get(pad.connector) ?? []), text]);
    else loose.push(text);
  }
  const named = (connector: string) => (/connector$/i.test(connector) ? connector.replace(/connector$/i, "plug") : connector);
  return [
    ...[...plugs].map(([connector, names]) =>
      used.has(connector) ? `${names.join(", ")} on the ${named(connector)}` : `the ${named(connector)}`,
    ),
    ...(loose.length ? [loose.join(", ")] : []),
  ].join("; ");
}

/** A name on the board, in the board's colours: dark, edged and lettered in the pads' gold. */
function BoardLabel({ text, x, y, w, h, font }: { text: string; x: number; y: number; w: number; h: number; font: number }) {
  return (
    <>
      <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx={2.5} fill="#0f1113" stroke="#f3d36b" strokeWidth={0.9} />
      <text x={x} y={y + font * 0.36} textAnchor="middle" fontSize={font} fontWeight={700} fill="#ffe9a6">
        {text}
      </text>
    </>
  );
}

/** Black or white, whichever reads on a fill of this colour. */
function inkOn(hex: string): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#111111" : "#ffffff";
}

/** A wire's tag: the pad's name, on a fill the colour of the wire. */
function WireTag({ wire }: { wire: Wire }) {
  const { text, x, y, w, h } = wire.tag!;
  // A ground's black needs an edge to show on a dark page and on the dark board.
  const edge = wire.net === "gnd" ? "#8a8a8a" : "rgba(0,0,0,0.55)";
  return (
    <>
      <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx={h / 2} fill={wire.colour} stroke={edge} strokeWidth={1} />
      <text x={x} y={y + TAG_FONT * 0.36} textAnchor="middle" fontSize={TAG_FONT} fontWeight={700} fill={inkOn(wire.colour)}>
        {text}
      </text>
    </>
  );
}
