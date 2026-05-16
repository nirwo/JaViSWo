// JaViSWo — JARVIS overlay (M3.2)
// Wake-word: Chrome `webkitSpeechRecognition` continuous-mode listens for
// "jarvis" in the background. On match the overlay opens and we capture the
// rest of the utterance via MediaRecorder, send to /api/voice/transcribe
// (mlx-whisper), then display the final transcript.
//
// State machine:
//   idle      — wake recognizer running silently, overlay hidden
//   wake      — wake word just heard, orb pulsing, switching to recording
//   listening — MediaRecorder active, drawing waveform
//   processing — sent audio to transcribe, awaiting result
//   done      — transcript on screen, awaiting user dismiss
//   error     — something failed, surface message + dismiss

const JARVIS_WAKE_REGEX = /\b(jarvis|javis|javiswo)\b/i;
const JARVIS_DISMISS_REGEX = /\b(thanks jarvis|that's all|that is all|dismiss)\b/i;
const SILENCE_RMS = 0.018;
const SILENCE_MS = 1400;
const MAX_RECORD_MS = 12_000;

function hasWakeWordSupport() {
  return typeof window !== 'undefined' && (
    'webkitSpeechRecognition' in window || 'SpeechRecognition' in window
  );
}

const JarvisOrb = ({ state }) => {
  // Pulse intensity follows the lifecycle. Listening = fast, processing = slow.
  const pulseClass =
    state === 'listening' ? 'jarvis-orb pulse-fast'
    : state === 'processing' ? 'jarvis-orb pulse-slow'
    : state === 'wake' ? 'jarvis-orb pulse-burst'
    : state === 'done' ? 'jarvis-orb pulse-soft'
    : 'jarvis-orb';
  return (
    <div className={pulseClass} aria-hidden="true">
      <div className="jarvis-orb-ring"/>
      <div className="jarvis-orb-core"/>
    </div>
  );
};

const JarvisOverlay = () => {
  const {
    jarvisEnabled, jarvisState, setJarvisState,
    jarvisTranscript, setJarvisTranscript,
    jarvisError, setJarvisError, dismissJarvis,
  } = useCockpit();

  const recognizerRef = React.useRef(null);
  const recorderRef = React.useRef(null);
  const audioCtxRef = React.useRef(null);
  const lastSpeechRef = React.useRef(0);
  const silenceTimerRef = React.useRef(null);
  const stoppingRef = React.useRef(false);
  const stateRef = React.useRef(jarvisState);
  React.useEffect(() => { stateRef.current = jarvisState; }, [jarvisState]);

  const stopRecording = React.useCallback(() => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
    const r = recorderRef.current;
    if (r && r.state !== 'inactive') r.stop();
  }, []);

  const startRecording = React.useCallback(async () => {
    setJarvisState('listening');
    setJarvisTranscript('');
    stoppingRef.current = false;

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      setJarvisError(`Microphone blocked: ${err.message}`);
      setJarvisState('error');
      return;
    }

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    audioCtxRef.current = audioCtx;
    const src = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);

    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus' : 'audio/webm';
    const recorder = new MediaRecorder(stream, { mimeType: mime });
    recorderRef.current = recorder;
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      try { audioCtx.close(); } catch {}
      audioCtxRef.current = null;

      if (chunks.length === 0) {
        setJarvisState('idle');
        return;
      }
      setJarvisState('processing');
      const blob = new Blob(chunks, { type: mime });
      try {
        const fd = new FormData();
        fd.append('audio', blob, 'voice.webm');
        const res = await fetch('/api/voice/transcribe', { method: 'POST', body: fd });
        const body = await res.json();
        if (body.ok && body.text) {
          setJarvisTranscript(body.text);
          setJarvisState('done');
        } else {
          setJarvisError(body.error?.detail ?? body.error?.code ?? 'transcription_failed');
          setJarvisState('error');
        }
      } catch (err) {
        setJarvisError(err.message ?? 'transcribe_request_failed');
        setJarvisState('error');
      }
    };
    recorder.start();
    lastSpeechRef.current = Date.now();

    const tick = () => {
      if (!audioCtxRef.current) return;
      analyser.getByteTimeDomainData(data);
      // RMS amplitude on [0,1]
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      if (rms > SILENCE_RMS) lastSpeechRef.current = Date.now();
      const idleFor = Date.now() - lastSpeechRef.current;
      const totalFor = Date.now() - (recorder.startedAt ?? Date.now());
      if (idleFor > SILENCE_MS || totalFor > MAX_RECORD_MS) {
        if (recorder.state !== 'inactive') recorder.stop();
        return;
      }
      requestAnimationFrame(tick);
    };
    recorder.startedAt = Date.now();
    requestAnimationFrame(tick);
  }, [setJarvisError, setJarvisState, setJarvisTranscript]);

  // Wake-word recognizer lifecycle. Mount/unmount when jarvisEnabled flips.
  React.useEffect(() => {
    if (!jarvisEnabled) {
      const r = recognizerRef.current;
      if (r) { try { r.stop(); } catch {} recognizerRef.current = null; }
      return;
    }
    if (!hasWakeWordSupport()) {
      // Safari / iOS — JARVIS still works via push-to-talk mic on the composer,
      // but no wake word. Stay idle silently.
      return;
    }

    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';
    recognizerRef.current = rec;

    rec.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript;
        interim += text;
      }
      if (stateRef.current === 'idle' && JARVIS_WAKE_REGEX.test(interim)) {
        setJarvisState('wake');
        // Stop the wake recognizer; we'll restart it after the user dismisses.
        try { rec.stop(); } catch {}
        setTimeout(() => startRecording(), 250);
      } else if (stateRef.current === 'done' && JARVIS_DISMISS_REGEX.test(interim)) {
        dismissJarvis();
      }
    };

    rec.onerror = (event) => {
      // 'no-speech' and 'aborted' are normal — restart silently after a beat
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      console.warn('[jarvis] wake recognizer:', event.error);
    };

    rec.onend = () => {
      // Browser stops it periodically — restart unless we're mid-recording
      if (!jarvisEnabled) return;
      const s = stateRef.current;
      if (s === 'idle' || s === 'done' || s === 'error') {
        try { rec.start(); } catch {}
      }
    };

    try { rec.start(); } catch (err) {
      console.warn('[jarvis] failed to start wake recognizer:', err);
    }

    return () => {
      try { rec.stop(); } catch {}
      recognizerRef.current = null;
    };
  }, [jarvisEnabled, startRecording, setJarvisState, dismissJarvis]);

  // Escape closes the overlay
  React.useEffect(() => {
    if (jarvisState === 'idle') return;
    const handler = (e) => {
      if (e.key === 'Escape') {
        stopRecording();
        dismissJarvis();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [jarvisState, dismissJarvis, stopRecording]);

  if (!jarvisEnabled || jarvisState === 'idle') return null;

  const headline =
    jarvisState === 'wake' ? 'Listening…'
    : jarvisState === 'listening' ? 'Go ahead, sir.'
    : jarvisState === 'processing' ? 'Thinking…'
    : jarvisState === 'done' ? 'I heard:'
    : jarvisState === 'error' ? 'Sorry, sir — something went wrong.'
    : '';

  return (
    <div className="jarvis-overlay" role="dialog" aria-label="JARVIS">
      <div className="jarvis-overlay-bg" onClick={() => { stopRecording(); dismissJarvis(); }}/>
      <div className="jarvis-overlay-inner">
        <JarvisOrb state={jarvisState}/>
        <div className="jarvis-headline">{headline}</div>
        {jarvisTranscript && (
          <div className="jarvis-transcript">{jarvisTranscript}</div>
        )}
        {jarvisError && (
          <div className="jarvis-transcript jarvis-error">{jarvisError}</div>
        )}
        <div className="jarvis-hint">
          Esc · click anywhere to dismiss
          {!hasWakeWordSupport() && ' · wake word unavailable in this browser'}
        </div>
      </div>
    </div>
  );
};

window.JarvisOverlay = JarvisOverlay;
window.hasJarvisWakeSupport = hasWakeWordSupport;
