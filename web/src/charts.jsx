import React, { useMemo, useRef, useState } from 'react';

export const CHART_COLORS = ['#2b62b3', '#2e8b3d', '#c96a12'];
const INK2 = '#4a5a6a', INK3 = '#8494a4', GRID = '#e7edf4';

function useTooltip() {
  const [tip, setTip] = useState(null);
  const show = (e, content) => setTip({ x: e.clientX + 12, y: e.clientY + 12, content });
  const hide = () => setTip(null);
  const el = tip ? (
    <div className="chart-tip" style={{ left: Math.min(tip.x, window.innerWidth - 190), top: tip.y }}>
      {tip.content}
    </div>
  ) : null;
  return { show, hide, el };
}

export function Legend({ items }) {
  if (items.length < 2) return null;
  return (
    <div className="legend">
      {items.map((it, i) => (
        <span className="k" key={it}><span className="sw" style={{ background: CHART_COLORS[i % 3] }} /> {it}</span>
      ))}
    </div>
  );
}

const niceMax = v => {
  if (v <= 0) return 10;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
};
const short = v => v >= 100000 ? (v / 100000).toFixed(1).replace(/\.0$/, '') + 'L'
  : v >= 1000 ? (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(Math.round(v));

// ---------- Line / area trend (single or multi series) ----------
export function LineChart({ data, series, height = 210, money = true }) {
  // data: [{label, [key]: value}], series: [{key, name}]
  const { show, hide, el } = useTooltip();
  const [hoverI, setHoverI] = useState(null);
  const W = 640, H = height, PL = 44, PR = 12, PT = 12, PB = 26;
  const max = niceMax(Math.max(1, ...data.flatMap(d => series.map(s => d[s.key] || 0))));
  const x = i => PL + (data.length < 2 ? (W - PL - PR) / 2 : (i * (W - PL - PR)) / (data.length - 1));
  const y = v => PT + (H - PT - PB) * (1 - v / max);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => f * max);

  const pathFor = key => data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[key] || 0).toFixed(1)}`).join(' ');

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }}
        onMouseLeave={() => { hide(); setHoverI(null); }}
        onMouseMove={e => {
          const rect = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * W;
          let best = 0, bd = Infinity;
          data.forEach((_, i) => { const d = Math.abs(x(i) - px); if (d < bd) { bd = d; best = i; } });
          setHoverI(best);
          const d = data[best];
          show(e, (
            <div>
              <b>{d.label}</b>
              {series.map((s, si) => (
                <div key={s.key}><span style={{ color: CHART_COLORS[si % 3] }}>●</span> {s.name}: {money ? '₹' + Number(d[s.key] || 0).toLocaleString('en-IN') : d[s.key]}</div>
              ))}
            </div>
          ));
        }}>
        {ticks.map(t => (
          <g key={t}>
            <line x1={PL} x2={W - PR} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth="1" />
            <text x={PL - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill={INK3}>{money ? short(t) : Math.round(t)}</text>
          </g>
        ))}
        {series.map((s, si) => (
          <g key={s.key}>
            {si === 0 && (
              <path d={`${pathFor(s.key)} L${x(data.length - 1)},${y(0)} L${x(0)},${y(0)} Z`}
                fill={CHART_COLORS[0]} opacity="0.08" />
            )}
            <path d={pathFor(s.key)} fill="none" stroke={CHART_COLORS[si % 3]} strokeWidth="2" strokeLinejoin="round" />
          </g>
        ))}
        {hoverI != null && (
          <g>
            <line x1={x(hoverI)} x2={x(hoverI)} y1={PT} y2={H - PB} stroke={INK3} strokeDasharray="3 3" strokeWidth="1" />
            {series.map((s, si) => (
              <circle key={s.key} cx={x(hoverI)} cy={y(data[hoverI][s.key] || 0)} r="4.5"
                fill={CHART_COLORS[si % 3]} stroke="#fff" strokeWidth="2" />
            ))}
          </g>
        )}
        {data.map((d, i) => (data.length <= 16 || i % Math.ceil(data.length / 10) === 0) && (
          <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="9.5" fill={INK3}>{d.label}</text>
        ))}
      </svg>
      <Legend items={series.map(s => s.name)} />
      {el}
    </div>
  );
}

// ---------- Horizontal bars (rankings: best sellers, branch-wise) ----------
export function BarList({ data, valueKey = 'value', labelKey = 'label', money = true, color = 0, maxBars = 8 }) {
  const { show, hide, el } = useTooltip();
  const rows = data.slice(0, maxBars);
  const max = Math.max(1, ...rows.map(r => r[valueKey] || 0));
  return (
    <div>
      {rows.length === 0 && <div className="empty">No data yet</div>}
      {rows.map((r, i) => (
        <div key={i} style={{ marginBottom: 9 }}
          onMouseMove={e => show(e, <div><b>{r[labelKey]}</b><div>{money ? '₹' + Number(r[valueKey]).toLocaleString('en-IN') : r[valueKey]}{r.sub ? ` · ${r.sub}` : ''}</div></div>)}
          onMouseLeave={hide}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.8rem', marginBottom: 3 }}>
            <span style={{ color: INK2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>{r[labelKey]}</span>
            <span className="mono" style={{ fontWeight: 650 }}>{money ? '₹' + Number(r[valueKey] || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 }) : r[valueKey]}</span>
          </div>
          <div style={{ background: GRID, borderRadius: 4, height: 10 }}>
            <div style={{
              width: `${Math.max(2, (r[valueKey] / max) * 100)}%`, height: '100%',
              background: CHART_COLORS[color % 3], borderRadius: 4,
            }} />
          </div>
        </div>
      ))}
      {el}
    </div>
  );
}

// ---------- Vertical grouped bars (monthly sales vs profit) ----------
export function Bars({ data, series, height = 210, money = true }) {
  const { show, hide, el } = useTooltip();
  const W = 640, H = height, PL = 44, PR = 12, PT = 12, PB = 26;
  const max = niceMax(Math.max(1, ...data.flatMap(d => series.map(s => d[s.key] || 0))));
  const y = v => PT + (H - PT - PB) * (1 - v / max);
  const groupW = (W - PL - PR) / Math.max(1, data.length);
  const barW = Math.min(26, (groupW - 8) / series.length);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }}>
        {[0, 0.25, 0.5, 0.75, 1].map(f => (
          <g key={f}>
            <line x1={PL} x2={W - PR} y1={y(f * max)} y2={y(f * max)} stroke={GRID} />
            <text x={PL - 6} y={y(f * max) + 3} textAnchor="end" fontSize="10" fill={INK3}>{money ? short(f * max) : Math.round(f * max)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = PL + i * groupW + groupW / 2;
          const x0 = cx - (barW * series.length + 2 * (series.length - 1)) / 2;
          return (
            <g key={i}>
              {series.map((s, si) => {
                const v = d[s.key] || 0;
                const by = y(v), bh = Math.max(1.5, y(0) - by);
                return (
                  <rect key={s.key} x={x0 + si * (barW + 2)} y={by} width={barW} height={bh}
                    rx="4" fill={CHART_COLORS[si % 3]}
                    onMouseMove={e => show(e, <div><b>{d.label}</b><div>{s.name}: {money ? '₹' + Number(v).toLocaleString('en-IN') : v}</div></div>)}
                    onMouseLeave={hide} />
                );
              })}
              <text x={cx} y={H - 8} textAnchor="middle" fontSize="9.5" fill={INK3}>{d.label}</text>
            </g>
          );
        })}
      </svg>
      <Legend items={series.map(s => s.name)} />
      {el}
    </div>
  );
}

// ---------- Donut (payment split) ----------
export function Donut({ data, money = true, size = 168 }) {
  // data: [{label, value}] — max 4 slices (fold rest into Other upstream)
  const { show, hide, el } = useTooltip();
  const total = data.reduce((a, d) => a + (d.value || 0), 0);
  const R = 62, r = 38, C = size / 2;
  let angle = -Math.PI / 2;
  // Color is assigned by the entity's position in `data`, not by slice rank,
  // so a zero-value slice dropping out never repaints the others.
  const arcs = data.map((d, i) => ({ d, i })).filter(x => x.d.value > 0).map(({ d, i }) => {
    const frac = d.value / total;
    const a0 = angle, a1 = angle + frac * Math.PI * 2 - 0.03;
    angle += frac * Math.PI * 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (a, rad) => `${C + rad * Math.cos(a)},${C + rad * Math.sin(a)}`;
    return { d, i, path: `M${p(a0, R)} A${R},${R} 0 ${large} 1 ${p(a1, R)} L${p(a1, r)} A${r},${r} 0 ${large} 0 ${p(a0, r)} Z` };
  });
  const gray = '#a4b2c0';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {total === 0 && <circle cx={C} cy={C} r={(R + r) / 2} fill="none" stroke={GRID} strokeWidth={R - r} />}
        {arcs.map(a => (
          <path key={a.d.label} d={a.path} fill={a.i < 3 ? CHART_COLORS[a.i] : gray}
            onMouseMove={e => show(e, <div><b>{a.d.label}</b><div>{money ? '₹' + Number(a.d.value).toLocaleString('en-IN') : a.d.value} ({Math.round((a.d.value / total) * 100)}%)</div></div>)}
            onMouseLeave={hide} />
        ))}
        <text x={C} y={C - 2} textAnchor="middle" fontSize="15" fontWeight="700" fill="#1c2733">
          {money ? short(total) : total}
        </text>
        <text x={C} y={C + 14} textAnchor="middle" fontSize="9" fill={INK3}>TOTAL</text>
      </svg>
      <div>
        {data.map((d, i) => (
          <div key={d.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '.84rem', marginBottom: 6 }}>
            <span className="sw" style={{ width: 10, height: 10, borderRadius: 3, background: i < 3 ? CHART_COLORS[i] : gray, display: 'inline-block' }} />
            <span style={{ color: INK2, minWidth: 60 }}>{d.label}</span>
            <b className="mono">{money ? '₹' + Number(d.value || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 }) : d.value}</b>
          </div>
        ))}
      </div>
      {el}
    </div>
  );
}
