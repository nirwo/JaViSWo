// JaViSWo — Icons + small shared pieces
// Inline SVG icons (no external dependency)

const Icon = ({ name, size = 14, stroke = 1.5, ...props }) => {
  const s = { width: size, height: size, fill: "none", stroke: "currentColor",
              strokeWidth: stroke, strokeLinecap: "round", strokeLinejoin: "round" };
  const paths = {
    folder: <><path d="M2 5a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5z"/></>,
    file:   <><path d="M5 2h7l5 5v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/><path d="M12 2v5h5"/></>,
    chevron:<><path d="M6 9l4 4 4-4"/></>,
    chevronR:<><path d="M9 6l4 4-4 4"/></>,
    plus:   <><path d="M10 4v12M4 10h12"/></>,
    x:      <><path d="M5 5l10 10M15 5L5 15"/></>,
    send:   <><path d="M3 11l16-7-7 16-2-7-7-2z"/></>,
    mic:    <><rect x="8" y="2" width="6" height="11" rx="3"/><path d="M5 11a6 6 0 0 0 12 0M11 17v3M8 20h6"/></>,
    git:    <><circle cx="6" cy="6" r="2"/><circle cx="6" cy="14" r="2"/><circle cx="14" cy="11" r="2"/><path d="M6 8v4M8 6h2a2 2 0 0 1 2 2v1"/></>,
    branch: <><circle cx="5" cy="4" r="2"/><circle cx="5" cy="16" r="2"/><circle cx="15" cy="8" r="2"/><path d="M5 6v8M7 8h3a3 3 0 0 1 3 3v-3"/></>,
    play:   <><path d="M5 3l12 7-12 7V3z"/></>,
    pause:  <><rect x="4" y="3" width="4" height="14" rx="1"/><rect x="12" y="3" width="4" height="14" rx="1"/></>,
    terminal:<><path d="M3 4h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/><path d="M5 8l3 2-3 2M10 12h4"/></>,
    sparkles:<><path d="M10 2v3M10 15v3M2 10h3M15 10h3M5 5l2 2M15 15l-2-2M5 15l2-2M15 5l-2 2"/><circle cx="10" cy="10" r="2.2"/></>,
    check:  <><path d="M4 10l4 4 8-9"/></>,
    warning:<><path d="M10 3l8 14H2L10 3z"/><path d="M10 8v4M10 14.5v.5"/></>,
    lock:   <><rect x="4" y="9" width="12" height="9" rx="2"/><path d="M7 9V6a3 3 0 0 1 6 0v3"/></>,
    wand:   <><path d="M3 17l11-11M14 4l2 2M16 9l1 1M5 11l1 1"/></>,
    settings:<><circle cx="10" cy="10" r="2.5"/><path d="M10 2v2M10 16v2M18 10h-2M4 10H2M15.6 15.6l-1.4-1.4M5.8 5.8L4.4 4.4M15.6 4.4l-1.4 1.4M5.8 14.2l-1.4 1.4"/></>,
    search: <><circle cx="9" cy="9" r="5"/><path d="M16 16l-3.5-3.5"/></>,
    history:<><circle cx="10" cy="10" r="7"/><path d="M10 6v4l3 2"/></>,
    bolt:   <><path d="M11 2L4 11h5l-1 7 7-9h-5l1-7z"/></>,
    diff:   <><path d="M5 3l-3 3 3 3M2 6h6M15 11l3 3-3 3M18 14h-6"/></>,
    phone:  <><rect x="6" y="2" width="8" height="16" rx="2"/><path d="M9 16h2"/></>,
    laptop: <><rect x="3" y="4" width="14" height="9" rx="1"/><path d="M2 16h16"/></>,
    refresh:<><path d="M3 10a7 7 0 0 1 12-5l2 2M17 4v3h-3M17 10a7 7 0 0 1-12 5l-2-2M3 16v-3h3"/></>,
    eye:    <><path d="M2 10s3-6 8-6 8 6 8 6-3 6-8 6-8-6-8-6z"/><circle cx="10" cy="10" r="2.5"/></>,
    layers: <><path d="M10 2l8 4-8 4-8-4 8-4z"/><path d="M2 10l8 4 8-4M2 14l8 4 8-4"/></>,
    upload: <><path d="M10 14V4M5 9l5-5 5 5M3 17h14"/></>,
    code:   <><path d="M6 7l-4 3 4 3M14 7l4 3-4 3M12 5l-4 10"/></>,
  };
  return <svg viewBox="0 0 20 20" style={s} {...props}>{paths[name]}</svg>;
};

// Mini sparkline (purely decorative)
const Sparkline = ({ values = [3,5,4,7,8,6,9,11,8,12,14,10], height = 18 }) => {
  return (
    <div className="spark" style={{ height }}>
      {values.map((v, i) => (
        <span key={i} style={{ height: `${(v / Math.max(...values)) * 100}%` }} />
      ))}
    </div>
  );
};

// Starfield (CSS-only twinkling dots, generated once)
const Starfield = ({ count = 80 }) => {
  const stars = React.useMemo(() => Array.from({length: count}, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    y: Math.random() * 100,
    size: Math.random() * 1.6 + 0.4,
    delay: Math.random() * 6,
    duration: 2 + Math.random() * 4,
    opacity: 0.3 + Math.random() * 0.6,
  })), [count]);
  return (
    <div className="starfield">
      {stars.map(s => (
        <span key={s.id} style={{
          position: "absolute",
          left: `${s.x}%`, top: `${s.y}%`,
          width: s.size, height: s.size,
          borderRadius: "50%",
          background: "white",
          opacity: s.opacity,
          boxShadow: `0 0 ${s.size * 2}px white`,
          animation: `twinkle ${s.duration}s ease-in-out ${s.delay}s infinite alternate`,
        }} />
      ))}
      <style>{`
        @keyframes twinkle {
          from { opacity: 0.1; transform: scale(0.7); }
          to   { opacity: 0.9; transform: scale(1); }
        }
      `}</style>
    </div>
  );
};

// Orb particles (orbiting cyan dots around the agent orb)
const OrbParticles = ({ count = 6 }) => {
  return (
    <div className="orb-particles">
      {Array.from({length: count}, (_, i) => {
        const angle = (360 / count) * i;
        const dur = 6 + (i % 3) * 2;
        return (
          <span key={i} className="orb-particle" style={{
            transform: `rotate(${angle}deg) translateX(64px) rotate(-${angle}deg)`,
            animation: `orb-orbit ${dur}s linear infinite`,
            animationDelay: `${-i * 0.3}s`,
          }} />
        );
      })}
      <style>{`
        @keyframes orb-orbit {
          from { transform: rotate(0deg) translateX(64px) rotate(0deg); }
          to   { transform: rotate(360deg) translateX(64px) rotate(-360deg); }
        }
      `}</style>
    </div>
  );
};

Object.assign(window, { Icon, Sparkline, Starfield, OrbParticles });
