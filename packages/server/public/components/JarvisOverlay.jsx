// JaViSWo — JARVIS overlay (M3.2)
// Wake-word: Chrome `webkitSpeechRecognition` continuous-mode listens for
// "jarvis" in the background. On match the overlay opens and we capture the
// rest of the utterance via MediaRecorder, send to /api/voice/transcribe
// (mlx-whisper), then display the final transcript.
//
// Diagnostic visibility: the floating <JarvisStatusPill> at bottom-right is
// ALWAYS visible when JARVIS is enabled. It shows the live recognizer status,
// so if the wake word isn't triggering, the user can see why (denied mic,
// insecure origin, no support, paused) and can also watch the live interim
// transcript to verify Chrome is actually hearing them.

const JARVIS_WAKE_REGEX = /\b(jarvis|javis|jervis|jaffis|javiswo|chervas)\b/i;
const JARVIS_DISMISS_REGEX = /\b(thanks jarvis|that('?s| is) all|dismiss|goodbye|bye jarvis)\b/i;
const SILENCE_RMS = 0.018;
const SILENCE_MS = 1400;
const MAX_RECORD_MS = 12_000;
// M3.7 multi-turn: between JARVIS replies and the user's next utterance,
// give a shorter window to start speaking — keeps the conversation
// snappy without trapping the mic on if the user has stopped.
const FOLLOWUP_MAX_RECORD_MS = 8_000;

function hasWakeWordSupport() {
  return typeof window !== 'undefined' && (
    'webkitSpeechRecognition' in window || 'SpeechRecognition' in window
  );
}

// localhost is a secure context for getUserMedia/SpeechRecognition;
// LAN IPs are not. Tell the user.
function isSecureContextOk() {
  if (typeof window === 'undefined') return false;
  if (window.isSecureContext) return true;
  const h = location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '::1';
}

const JarvisOrb = ({ state }) => {
  const pulseClass =
    state === 'listening' ? 'jarvis-orb pulse-fast'
    : state === 'processing' ? 'jarvis-orb pulse-slow'
    : state === 'jarvis-thinking' ? 'jarvis-orb pulse-slow'
    : state === 'wake' ? 'jarvis-orb pulse-burst'
    : state === 'done' ? 'jarvis-orb pulse-soft'
    : state === 'jarvis-done' ? 'jarvis-orb pulse-soft'
    : 'jarvis-orb';
  return (
    <div className={pulseClass} aria-hidden="true">
      <div className="jarvis-orb-ring"/>
      <div className="jarvis-orb-core"/>
    </div>
  );
};

const JarvisStatusPill = () => {
  const {
    jarvisEnabled, jarvisListenerStatus, jarvisInterimText, setJarvisEnabled,
  } = useCockpit();
  if (!jarvisEnabled) return null;

  const interim = (jarvisInterimText || '').trim();
  const tail = interim.length > 60 ? '…' + interim.slice(-60) : interim;

  const cls =
    jarvisListenerStatus === 'ready' ? 'jarvis-pill ok'
    : jarvisListenerStatus === 'starting' ? 'jarvis-pill'
    : jarvisListenerStatus === 'paused' ? 'jarvis-pill'
    : 'jarvis-pill warn';

  let text;
  switch (jarvisListenerStatus) {
    case 'off':       text = 'JARVIS off'; break;
    case 'starting':  text = 'starting…'; break;
    case 'ready':     text = tail ? `hearing: "${tail}"` : 'standing by · say "hey JARVIS"'; break;
    case 'paused':    text = 'paused (Chrome auto-stops) · restarting'; break;
    case 'no-support': text = 'wake word unsupported (use Chrome)'; break;
    case 'insecure':  text = `wake needs HTTPS — open https://${location.hostname}:8788`; break;
    case 'no-mic':    text = 'no microphone available'; break;
    case 'denied':    text = 'microphone denied · check site permissions'; break;
    case 'error':     text = 'recognizer error'; break;
    default:          text = jarvisListenerStatus;
  }

  return (
    <div className={cls} role="status" aria-live="polite">
      <span className="jarvis-pill-dot"/>
      <span className="jarvis-pill-text">{text}</span>
      <button
        className="jarvis-pill-close"
        title="Disable JARVIS"
        onClick={() => setJarvisEnabled(false)}
      >×</button>
    </div>
  );
};

const JarvisOverlay = () => {
  const {
    jarvisEnabled, jarvisState, setJarvisState,
    jarvisTranscript, setJarvisTranscript,
    jarvisError, setJarvisError, dismissJarvis,
    setJarvisListenerStatus, setJarvisInterimText,
    sayToJarvis, jarvisReply, setJarvisReply, jarvisThinking, jarvisSpeaking,
  } = useCockpit();

  // Once the wake recognizer hands us a finalized transcript ('done' state)
  // we POST it to JARVIS and switch to 'jarvis-thinking' so the overlay can
  // render his reply as it streams over WS. The overlay stays open until
  // dismissed manually.
  React.useEffect(() => {
    if (jarvisState !== 'done') return;
    if (!jarvisTranscript || !jarvisTranscript.trim()) return;
    setJarvisState('jarvis-thinking');
    sayToJarvis(jarvisTranscript).catch(() => {
      // sayToJarvis already updates jarvisThinking; surface a generic error
      // in the overlay so the user sees something went wrong.
      setJarvisError('Failed to reach JARVIS — check the server.');
      setJarvisState('error');
    });
  }, [jarvisState, jarvisTranscript, sayToJarvis, setJarvisState, setJarvisError]);

  // When JARVIS finishes thinking (his agent's status flips from running to
  // completed), surface a 'jarvis-done' state so the orb stops pulsing.
  React.useEffect(() => {
    if (jarvisState !== 'jarvis-thinking') return;
    if (jarvisThinking) return;
    if (jarvisReply) setJarvisState('jarvis-done');
  }, [jarvisState, jarvisThinking, jarvisReply, setJarvisState]);

  // M3.7 — multi-turn conversation. After JARVIS finishes speaking
  // (audio playback ends), automatically re-arm the mic for the user's
  // next utterance. Loop continues until the user says a dismiss
  // phrase, hits Escape, or stays silent for FOLLOWUP_MAX_RECORD_MS.
  const wasSpeakingRef = React.useRef(false);
  React.useEffect(() => {
    const justFinishedSpeaking = wasSpeakingRef.current && !jarvisSpeaking;
    wasSpeakingRef.current = jarvisSpeaking;
    if (!justFinishedSpeaking) return undefined;
    if (jarvisState !== 'jarvis-done') return undefined;
    // Brief grace period before re-arming so the user has a beat to
    // process what JARVIS just said.
    const t = setTimeout(() => {
      if (stateRef.current === 'jarvis-done') {
        // followUp flag tells startRecording to use the shorter
        // silence window + bail silently if no speech detected.
        startRecording(true);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [jarvisSpeaking, jarvisState]);

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

  const startRecording = React.useCallback(async (followUp = false) => {
    setJarvisState('listening');
    setJarvisTranscript('');
    stoppingRef.current = false;
    const maxRecordMs = followUp ? FOLLOWUP_MAX_RECORD_MS : MAX_RECORD_MS;
    // Track whether we ever crossed the speech threshold during this
    // recording. If not (user stayed silent during a follow-up turn),
    // we exit the conversation cleanly to idle instead of sending a
    // blank transcript to JARVIS.
    let speechDetected = false;

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      setJarvisError(`Microphone blocked: ${err.message}`);
      setJarvisState('error');
      setJarvisListenerStatus('denied');
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

      // M3.7 multi-turn: in follow-up mode, if user never spoke, end
      // the conversation cleanly without sending blank audio to STT.
      if (followUp && !speechDetected) {
        setJarvisState('idle');
        setJarvisTranscript('');
        setJarvisReply('');
        return;
      }
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
          // M3.7 — if user said "thanks JARVIS"/etc on a follow-up turn,
          // end the conversation rather than sending it to JARVIS.
          if (JARVIS_DISMISS_REGEX.test(body.text)) {
            dismissJarvis();
            return;
          }
          setJarvisTranscript(body.text);
          setJarvisState('done');
        } else if (followUp) {
          // Empty transcript on a follow-up = stayed silent, exit cleanly.
          setJarvisState('idle');
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
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      if (rms > SILENCE_RMS) {
        lastSpeechRef.current = Date.now();
        speechDetected = true;
      }
      const idleFor = Date.now() - lastSpeechRef.current;
      const totalFor = Date.now() - (recorder.startedAt ?? Date.now());
      // In follow-up mode, exit fast if the user clearly isn't going
      // to speak (no speech detected within the first 4s of the window).
      const earlyBail = followUp && !speechDetected && totalFor > 4_000;
      if (idleFor > SILENCE_MS || totalFor > maxRecordMs || earlyBail) {
        if (recorder.state !== 'inactive') recorder.stop();
        return;
      }
      requestAnimationFrame(tick);
    };
    recorder.startedAt = Date.now();
    requestAnimationFrame(tick);
  }, [setJarvisError, setJarvisState, setJarvisTranscript, setJarvisListenerStatus, setJarvisReply, dismissJarvis]);

  // Wake-word recognizer lifecycle. Mount/unmount when jarvisEnabled flips.
  React.useEffect(() => {
    if (!jarvisEnabled) {
      const r = recognizerRef.current;
      if (r) { try { r.stop(); } catch {} recognizerRef.current = null; }
      return;
    }

    if (!isSecureContextOk()) {
      setJarvisListenerStatus('insecure');
      return;
    }
    if (!hasWakeWordSupport()) {
      setJarvisListenerStatus('no-support');
      return;
    }

    setJarvisListenerStatus('starting');
    let cancelled = false;

    // Force the mic permission prompt up front. Chrome's webkitSpeechRecognition
    // will silently fail with error='not-allowed' if mic permission is missing;
    // calling getUserMedia explicitly triggers the prompt and surfaces the
    // failure path visibly.
    (async () => {
      try {
        const probeStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // We just needed the permission — release the probe immediately so the
        // recognizer can claim the mic itself.
        probeStream.getTracks().forEach(t => t.stop());
      } catch (err) {
        if (cancelled) return;
        const msg = String(err?.name || err?.message || '');
        if (/NotAllowedError|denied/i.test(msg)) setJarvisListenerStatus('denied');
        else if (/NotFoundError|DeviceNotFound/i.test(msg)) setJarvisListenerStatus('no-mic');
        else setJarvisListenerStatus('error');
        return;
      }
      if (cancelled) return;

      const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
      const rec = new Ctor();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = 'en-US';
      recognizerRef.current = rec;

      rec.onstart = () => { setJarvisListenerStatus('ready'); };

      rec.onresult = (event) => {
        // Build the running interim — concatenate every result from the
        // resultIndex onward. The dispatch state is whatever's mutable.
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          interim += event.results[i][0].transcript;
        }
        setJarvisInterimText(interim);
        if (stateRef.current === 'idle' && JARVIS_WAKE_REGEX.test(interim)) {
          setJarvisInterimText('');
          setJarvisState('wake');
          try { rec.stop(); } catch {}
          setTimeout(() => startRecording(), 250);
        } else if (stateRef.current === 'done' && JARVIS_DISMISS_REGEX.test(interim)) {
          setJarvisInterimText('');
          dismissJarvis();
        }
      };

      rec.onerror = (event) => {
        // 'no-speech' and 'aborted' are normal — they'll be followed by onend
        if (event.error === 'no-speech' || event.error === 'aborted') return;
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          setJarvisListenerStatus('denied');
          setJarvisError('Microphone access denied. Open the site permissions in Chrome and allow the mic.');
          return;
        }
        if (event.error === 'audio-capture') {
          setJarvisListenerStatus('no-mic');
          return;
        }
        setJarvisListenerStatus('error');
        setJarvisError(`Recognizer error: ${event.error}`);
      };

      rec.onend = () => {
        // Chrome auto-stops continuous mode after silence. Restart unless
        // we're actively recording the wake-up utterance.
        if (cancelled || !recognizerRef.current) return;
        const s = stateRef.current;
        if (s === 'idle' || s === 'done' || s === 'error') {
          setJarvisListenerStatus('paused');
          setTimeout(() => {
            if (cancelled || !recognizerRef.current) return;
            try { rec.start(); } catch (err) {
              // Already-started errors are harmless; otherwise surface.
              if (!/already started/i.test(String(err?.message))) {
                setJarvisListenerStatus('error');
                setJarvisError(`Failed to restart: ${err.message}`);
              }
            }
          }, 150);
        }
      };

      try { rec.start(); } catch (err) {
        setJarvisListenerStatus('error');
        setJarvisError(`Failed to start: ${err.message}`);
      }
    })();

    return () => {
      cancelled = true;
      const r = recognizerRef.current;
      if (r) { try { r.stop(); } catch {} recognizerRef.current = null; }
      setJarvisListenerStatus('off');
    };
  }, [jarvisEnabled, startRecording, setJarvisState, dismissJarvis,
       setJarvisListenerStatus, setJarvisInterimText, setJarvisError]);

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

  return (
    <>
      <JarvisStatusPill/>
      {jarvisEnabled && jarvisState !== 'idle' && (
        <div className="jarvis-overlay" role="dialog" aria-label="JARVIS">
          <div className="jarvis-overlay-bg" onClick={() => { stopRecording(); dismissJarvis(); }}/>
          <div className="jarvis-overlay-inner">
            <JarvisOrb state={jarvisState}/>
            <div className="jarvis-headline">
              {jarvisState === 'wake' && 'Listening…'}
              {jarvisState === 'listening' && 'Go ahead, sir.'}
              {jarvisState === 'processing' && 'Thinking…'}
              {jarvisState === 'done' && 'I heard:'}
              {jarvisState === 'jarvis-thinking' && 'JARVIS is thinking…'}
              {jarvisState === 'jarvis-done' && 'JARVIS:'}
              {jarvisState === 'error' && 'Sorry, sir — something went wrong.'}
            </div>
            {(jarvisState === 'jarvis-thinking' || jarvisState === 'jarvis-done')
              ? (jarvisReply
                  ? <div className="jarvis-transcript">{jarvisReply}</div>
                  : jarvisTranscript && <div className="jarvis-transcript" style={{ opacity: 0.6 }}>You said: {jarvisTranscript}</div>)
              : jarvisTranscript && <div className="jarvis-transcript">{jarvisTranscript}</div>
            }
            {jarvisError && (
              <div className="jarvis-transcript jarvis-error">{jarvisError}</div>
            )}
            <div className="jarvis-hint">
              Esc · click anywhere to dismiss
              {!hasWakeWordSupport() && ' · wake word unavailable in this browser'}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

window.JarvisOverlay = JarvisOverlay;
window.JarvisStatusPill = JarvisStatusPill;
window.hasJarvisWakeSupport = hasWakeWordSupport;
window.isJarvisSecureContextOk = isSecureContextOk;
