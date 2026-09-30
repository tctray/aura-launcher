// src/components/Sparkline.jsx — tiny dependency-free line chart
export default function Sparkline({ values = [], color = "#ff7a1a", height = 36, max }) {
  const idx = values.map((v, i) => (v == null ? -1 : i)).filter((i) => i !== -1);
  if (idx.length < 2) return <div style={{ height }} />;

  const hi = max ?? Math.max(...idx.map((i) => values[i]), 1);
  const w = 100;
  const step = w / Math.max(1, values.length - 1);
  const pt = (i) => {
    const x = i * step;
    const y = height - (Math.min(values[i], hi) / hi) * (height - 2) - 1;
    return `${x.toFixed(2)} ${y.toFixed(2)}`;
  };
  const line = idx.map((i, n) => `${n ? "L" : "M"}${pt(i)}`).join(" ");
  const firstX = (idx[0] * step).toFixed(2);
  const lastX = (idx[idx.length - 1] * step).toFixed(2);

  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none"
         style={{ width: "100%", height, display: "block" }} aria-hidden="true">
      <path d={`${line} L${lastX} ${height} L${firstX} ${height} Z`} fill={color} opacity="0.14" />
      <path d={line} fill="none" stroke={color} strokeWidth="1.6"
            vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}