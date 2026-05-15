// JaViSWo — Main app

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "animationIntensity": 100,
  "density": "comfortable",
  "accent": ["#a78bfa", "#22d3ee", "#8b5cf6"],
  "background": "aurora",
  "voiceActive": false,
  "permission": true
}/*EDITMODE-END*/;

// Palettes: stored as arrays so TweakColor renders nice swatches.
// First color = primary accent, second = secondary accent, third = primary-dark.
const ACCENT_PALETTES = [
  ["#a78bfa", "#22d3ee", "#8b5cf6"], // violet (default)
  ["#22d3ee", "#a78bfa", "#06b6d4"], // cyan
  ["#f472b6", "#a78bfa", "#ec4899"], // pink
  ["#34d399", "#22d3ee", "#10b981"], // emerald
];

const App = () => {
  const [tweaks, set] = useTweaks(TWEAK_DEFAULTS);

  const [voice, setVoice] = React.useState(tweaks.voiceActive);
  const [permission, setPermission] = React.useState(tweaks.permission);

  // Sync background + accent CSS variables
  React.useEffect(() => {
    const root = document.documentElement;
    const anim = Math.max(0.05, tweaks.animationIntensity / 100);
    root.style.setProperty("--anim", anim);
    root.dataset.density = tweaks.density;
    root.dataset.background = tweaks.background;

    const p = Array.isArray(tweaks.accent) ? tweaks.accent : ACCENT_PALETTES[0];
    const [a, a2, a3] = p;
    root.style.setProperty("--accent", a);
    root.style.setProperty("--accent-2", a2);
    root.style.setProperty("--violet-500", a);
    root.style.setProperty("--violet-600", a3);
    root.style.setProperty("--cyan-400", a2);
  }, [tweaks]);

  React.useEffect(() => setVoice(tweaks.voiceActive), [tweaks.voiceActive]);
  React.useEffect(() => setPermission(tweaks.permission), [tweaks.permission]);

  const bg = tweaks.background;

  return (
    <>
      {/* Background layers */}
      {(bg === "aurora" || bg === "particles") && <div className="aurora"/>}
      {bg === "aurora" && <div className="grid-overlay"/>}
      {(bg === "aurora" || bg === "particles") && <Starfield count={tweaks.animationIntensity > 30 ? 80 : 0}/>}
      {bg === "solid" && <div style={{position:"fixed", inset:0, background:"var(--bg-0)", zIndex:0}}/>}

      <BootSequence/>

      <div className="app">
        <TopBar/>
        <div className="shell">
          <LeftRail/>
          <CenterStage
            voice={voice}
            onToggleVoice={() => setVoice(v => !v)}
            showPermission={permission}
            onAllow={() => setPermission(false)}
            onDeny={() => setPermission(false)}
          />
          <RightRail/>
        </div>
      </div>

      {/* Tweaks panel */}
      <TweaksPanel title="Tweaks">
        <TweakSection label="Motion">
          <TweakSlider
            label="Animation intensity"
            value={tweaks.animationIntensity}
            min={0} max={100} step={10}
            onChange={v => set("animationIntensity", v)}
            unit="%"
          />
        </TweakSection>

        <TweakSection label="Layout">
          <TweakRadio
            label="Density"
            value={tweaks.density}
            options={[
              { value: "comfortable", label: "Comfortable" },
              { value: "compact", label: "Compact" },
            ]}
            onChange={v => set("density", v)}
          />
        </TweakSection>

        <TweakSection label="Accent palette">
          <TweakColor
            label="Colors"
            value={tweaks.accent}
            options={ACCENT_PALETTES}
            onChange={v => set("accent", v)}
          />
        </TweakSection>

        <TweakSection label="Background">
          <TweakRadio
            label="Style"
            value={tweaks.background}
            options={[
              { value: "aurora",    label: "Aurora" },
              { value: "particles", label: "Stars" },
              { value: "solid",     label: "Solid" },
            ]}
            onChange={v => set("background", v)}
          />
        </TweakSection>

        <TweakSection label="States">
          <TweakToggle
            label="Voice listening"
            value={voice}
            onChange={v => { setVoice(v); set("voiceActive", v); }}
          />
          <TweakToggle
            label="Approval prompt"
            value={permission}
            onChange={v => { setPermission(v); set("permission", v); }}
          />
        </TweakSection>
      </TweaksPanel>
    </>
  );
};

ReactDOM.createRoot(document.getElementById("root")).render(<App/>);
