import { anchorsOf, type Anchor, type ConnectDraft } from "./connection";

// Length of the preview arrowhead in screen pixels.
const ARROWHEAD_SIZE = 10;

function dotStyle(p: { x: number; y: number }) {
  return { left: p.x, top: p.y };
}

// Transient DOM/SVG overlay above the canvas: hover anchors, the live
// connector preview, and snap feedback. Renders nothing into the scene.
export function ConnectionLayer(props: {
  hovered: any | null;
  connect: ConnectDraft | null;
  toViewport: (p: { x: number; y: number }) => { x: number; y: number };
  onStartConnect: (anchor: Anchor) => void;
}) {
  const { hovered, connect, toViewport, onStartConnect } = props;

  if (connect) {
    const from = toViewport(connect.sourceAnchor);
    const to = toViewport(connect.target ? connect.target.anchor : connect.pointer);
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const head = [
      to,
      {
        x: to.x - ARROWHEAD_SIZE * Math.cos(angle - Math.PI / 6),
        y: to.y - ARROWHEAD_SIZE * Math.sin(angle - Math.PI / 6),
      },
      {
        x: to.x - ARROWHEAD_SIZE * Math.cos(angle + Math.PI / 6),
        y: to.y - ARROWHEAD_SIZE * Math.sin(angle + Math.PI / 6),
      },
    ]
      .map((p) => `${p.x},${p.y}`)
      .join(" ");

    return (
      <>
        <svg className="connection-preview">
          <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
          <polygon points={head} />
        </svg>
        <div className="connection-anchor connection-anchor--active" style={dotStyle(from)} />
        {connect.target && (
          <div className="connection-anchor connection-anchor--snap" style={dotStyle(to)} />
        )}
      </>
    );
  }

  if (!hovered) {
    return null;
  }

  return (
    <>
      {anchorsOf(hovered).map((anchor) => (
        <div
          key={anchor.id}
          className="connection-anchor"
          style={dotStyle(toViewport(anchor))}
          onPointerDown={(event) => {
            event.stopPropagation();
            event.preventDefault();
            onStartConnect(anchor);
          }}
        />
      ))}
    </>
  );
}
