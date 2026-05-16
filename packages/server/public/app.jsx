// JaViSWo — Main app

const SIZES_STORAGE_KEY = 'cockpit:layout:v1';
function loadSizes() {
  try {
    const raw = localStorage.getItem(SIZES_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}
function saveSizes(payload) {
  try { localStorage.setItem(SIZES_STORAGE_KEY, JSON.stringify(payload)); } catch {}
}

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
  const { ttsEnabled, setTts, jarvisVoice, setJarvisVoice, hideToolWork, setHide } = useCockpit();

  const [permission, setPermission] = React.useState(tweaks.permission);

  const initialSizes = loadSizes() ?? { left: 280, right: 360 };
  const [leftW, setLeftW] = React.useState(initialSizes.left);
  const [rightW, setRightW] = React.useState(initialSizes.right);
  React.useEffect(() => { saveSizes({ left: leftW, right: rightW }); }, [leftW, rightW]);

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
        <div
          className="shell"
          style={{
            // CSS variables — media query in styles.css can override these
            // on mobile (where rails are hidden and the grid collapses to
            // a single column). Without variables, the inline grid-template-
            // columns would always win and force the desktop layout.
            '--shell-left-w': `${leftW}px`,
            '--shell-right-w': `${rightW}px`,
          }}
        >
          <LeftRail/>
          <Resizer side="left"  min={200} max={520} getCurrent={() => leftW}  onResize={setLeftW}/>
          <CenterStage
            showPermission={permission}
            onAllow={() => setPermission(false)}
            onDeny={() => setPermission(false)}
          />
          <Resizer side="right" min={240} max={520} getCurrent={() => rightW} onResize={setRightW}/>
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
            label="Voice reply (TTS)"
            value={ttsEnabled}
            onChange={v => setTts(v)}
          />
          <TweakToggle
            label="JARVIS voice"
            value={jarvisVoice}
            onChange={v => setJarvisVoice(v)}
          />
          <TweakToggle
            label="Approval prompt"
            value={permission}
            onChange={v => { setPermission(v); set("permission", v); }}
          />
          <TweakToggle
            label="Hide tool work"
            value={hideToolWork}
            onChange={v => setHide(v)}
          />
        </TweakSection>
      </TweaksPanel>
    </>
  );
};

ReactDOM.createRoot(document.getElementById("root")).render(
  <CockpitProvider>
    <App/>
    <FolderPicker/>
    <JarvisOverlay/>
  </CockpitProvider>
);
