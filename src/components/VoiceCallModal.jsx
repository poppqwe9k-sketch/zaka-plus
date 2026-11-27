import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState
} from 'react';
import {
  extractSpeechTranscript,
  getSpeechRecognitionConstructor,
  resolveSpeechLocale
} from '../utils/speechDictation.js';
import {
  extractAudioBase64Payload,
  formatCallDuration,
  prepareTextForSpeech
} from '../utils/voiceCall.js';

function MicOnIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8" />
    </svg>
  );
}

function MicOffIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M1 1l22 22" />
      <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V5a3 3 0 0 0-5.94-.6" />
      <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23M12 19v3M8 22h8" />
    </svg>
  );
}

function SpeakerOnIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M11 5L6 9H2v6h4l5 4V5z" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  );
}

function SpeakerOffIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M11 5L6 9H2v6h4l5 4V5z" />
      <path d="M23 9l-6 6M17 9l6 6" />
    </svg>
  );
}

const VoiceCallModal = forwardRef(function VoiceCallModal(
  {
    open,
    onClose,
    isOnline,
    currentUser,
    onRequireAuth,
    onSendVoiceTurn,
    onPhaseChange,
    langCode,
    t,
    EmblemIcon,
    logoRef
  },
  ref
) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [callState, setCallState] = useState('connecting');
  const [muted, setMuted] = useState(false);
  const [speakerEnabled, setSpeakerEnabled] = useState(true);
  const [callError, setCallError] = useState('');
  const [micFallbackMode, setMicFallbackMode] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [callHistory, setCallHistory] = useState([]);

  const openRef = useRef(open);
  const mutedRef = useRef(muted);
  const speakerRef = useRef(speakerEnabled);
  const busyRef = useRef(false);
  const recognitionRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const pendingSpeechRef = useRef('');
  const activeAudioRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const recordedChunksRef = useRef([]);

  openRef.current = open;
  mutedRef.current = muted;
  speakerRef.current = speakerEnabled;

  useEffect(() => {
    if (typeof onPhaseChange === 'function') {
      onPhaseChange(open ? callState : 'idle');
    }
  }, [open, callState, onPhaseChange]);

  const stopAudioPlayback = useCallback(() => {
    if (activeAudioRef.current) {
      try {
        activeAudioRef.current.pause();
        activeAudioRef.current.src = '';
      } catch {
        // Ignore cleanup errors.
      }
      activeAudioRef.current = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore cleanup errors.
      }
    }
  }, []);

  const stopSpeechRecognition = useCallback(() => {
    if (silenceTimerRef.current) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    const rec = recognitionRef.current;
    if (rec) {
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      try {
        rec.abort();
      } catch {
        // Ignore abort errors.
      }
      recognitionRef.current = null;
    }
  }, []);

  const stopMediaRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {
        // Ignore stop errors.
      }
    }
    mediaRecorderRef.current = null;
    if (mediaStreamRef.current) {
      for (const track of mediaStreamRef.current.getTracks()) {
        try {
          track.stop();
        } catch {
          // Ignore track stop errors.
        }
      }
      mediaStreamRef.current = null;
    }
  }, []);

  const speakWithBrowserFallback = useCallback((text) => {
    return new Promise((resolve) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window) || !speakerRef.current) {
        resolve();
        return;
      }
      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = resolveSpeechLocale(langCode);
        utterance.rate = 1.02;
        utterance.onend = () => resolve();
        utterance.onerror = () => resolve();
        window.speechSynthesis.speak(utterance);
        window.setTimeout(resolve, Math.min(18000, Math.max(2200, text.length * 75)));
      } catch {
        resolve();
      }
    });
  }, [langCode]);

  const speakReply = useCallback(async (replyText) => {
    const cleanSpeech = prepareTextForSpeech(replyText);
    if (!cleanSpeech || !speakerRef.current || !openRef.current) return;

    setCallState('speaking');
    try {
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: cleanSpeech,
          voiceName: 'Kore',
          langCode
        })
      });
      const data = await response.json().catch(() => null);
      if (!openRef.current || !speakerRef.current) return;

      if (response.ok && data?.audioBase64) {
        await new Promise((resolve) => {
          const audio = new Audio(`data:${data.mimeType || 'audio/wav'};base64,${data.audioBase64}`);
          activeAudioRef.current = audio;
          const finish = () => {
            if (activeAudioRef.current === audio) activeAudioRef.current = null;
            resolve();
          };
          audio.onended = finish;
          audio.onerror = finish;
          audio.play().catch(() => {
            finish();
            speakWithBrowserFallback(cleanSpeech).catch(() => {});
          });
        });
        return;
      }
    } catch {
      // Fall back to browser speech synthesis.
    }

    if (openRef.current && speakerRef.current) {
      await speakWithBrowserFallback(cleanSpeech);
    }
  }, [langCode, speakWithBrowserFallback]);

  const startContinuousRecognition = useCallback(() => {
    if (!openRef.current || !currentUser || mutedRef.current || busyRef.current) return;
    const SpeechCtor = getSpeechRecognitionConstructor(typeof window !== 'undefined' ? window : null);
    if (!SpeechCtor) {
      setMicFallbackMode(true);
      setCallState('ready');
      return;
    }

    stopSpeechRecognition();
    pendingSpeechRef.current = '';
    setLiveTranscript('');

    try {
      const recognition = new SpeechCtor();
      recognition.lang = resolveSpeechLocale(langCode);
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      recognition.onresult = (event) => {
        if (!openRef.current || mutedRef.current || busyRef.current) return;
        const { finalText, interimText } = extractSpeechTranscript(event?.results);
        const combined = [finalText, interimText].filter(Boolean).join(' ').trim();
        setLiveTranscript(combined);
        if (finalText) {
          pendingSpeechRef.current = finalText;
          if (silenceTimerRef.current) window.clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = window.setTimeout(() => {
            const spoken = pendingSpeechRef.current.trim();
            pendingSpeechRef.current = '';
            if (spoken && openRef.current && !busyRef.current) {
              stopSpeechRecognition();
              processUserUtterance(spoken);
            }
          }, 950);
        }
      };

      recognition.onerror = (event) => {
        const errCode = event?.error || '';
        if (errCode === 'not-allowed' || errCode === 'service-not-allowed' || errCode === 'audio-capture') {
          setMicFallbackMode(true);
          setCallState('ready');
          setCallError(t.voiceCallNoMicFallback);
          stopSpeechRecognition();
        }
      };

      recognition.onend = () => {
        if (recognitionRef.current === recognition) {
          recognitionRef.current = null;
          const pending = pendingSpeechRef.current.trim();
          pendingSpeechRef.current = '';
          if (pending && openRef.current && !busyRef.current) {
            processUserUtterance(pending);
            return;
          }
          if (openRef.current && !mutedRef.current && !busyRef.current && !micFallbackMode) {
            window.setTimeout(() => {
              if (openRef.current && !mutedRef.current && !busyRef.current) {
                startContinuousRecognition();
              }
            }, 250);
          }
        }
      };

      recognitionRef.current = recognition;
      setCallState('listening');
      recognition.start();
    } catch {
      setMicFallbackMode(true);
      setCallState('ready');
    }
  }, [currentUser, langCode, micFallbackMode, stopSpeechRecognition, t.voiceCallNoMicFallback]);

  const processUserUtterance = useCallback(async (utteranceText) => {
    const clean = typeof utteranceText === 'string' ? utteranceText.trim() : '';
    if (!clean || busyRef.current || !openRef.current) return;

    if (!isOnline || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
      setCallError(t.offlineSendError);
      return;
    }

    if (!currentUser) {
      onRequireAuth();
      return;
    }

    busyRef.current = true;
    stopSpeechRecognition();
    stopAudioPlayback();
    setCallError('');
    setLiveTranscript('');
    setCallState('thinking');
    setCallHistory((prev) => [...prev, { id: `u-${Date.now()}`, role: 'user', text: clean }]);

    try {
      const result = await onSendVoiceTurn(clean);
      if (!openRef.current) return;

      if (result?.error) {
        setCallError(result.error);
      }
      if (result?.replyText) {
        setCallHistory((prev) => [...prev, { id: `a-${Date.now()}`, role: 'assistant', text: result.replyText }]);
        await speakReply(result.replyText);
      }
    } catch (err) {
      if (openRef.current) {
        setCallError(err instanceof Error ? err.message : t.genericError);
      }
    } finally {
      busyRef.current = false;
      if (openRef.current) {
        if (mutedRef.current) {
          setCallState('muted');
        } else if (micFallbackMode) {
          setCallState('ready');
        } else {
          startContinuousRecognition();
        }
      }
    }
  }, [currentUser, isOnline, micFallbackMode, onRequireAuth, onSendVoiceTurn, speakReply, startContinuousRecognition, stopAudioPlayback, stopSpeechRecognition, t.genericError, t.offlineSendError]);

  useImperativeHandle(ref, () => ({
    submitTextTurn: (text) => processUserUtterance(text)
  }), [processUserUtterance]);

  useEffect(() => {
    if (!open) {
      stopSpeechRecognition();
      stopMediaRecording();
      stopAudioPlayback();
      busyRef.current = false;
      setElapsedSeconds(0);
      setLiveTranscript('');
      setCallError('');
      return undefined;
    }

    setElapsedSeconds(0);
    setMuted(false);
    setCallError('');
    setCallHistory([]);
    setMicFallbackMode(false);

    if (!currentUser) {
      setCallState('ready');
      return undefined;
    }

    setCallState('connecting');
    const timer = window.setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);

    const startTimer = window.setTimeout(() => {
      if (!openRef.current) return;
      const SpeechCtor = getSpeechRecognitionConstructor(typeof window !== 'undefined' ? window : null);
      if (SpeechCtor) {
        startContinuousRecognition();
      } else {
        setMicFallbackMode(true);
        setCallState('ready');
      }
    }, 220);

    return () => {
      window.clearInterval(timer);
      window.clearTimeout(startTimer);
      stopSpeechRecognition();
      stopMediaRecording();
      stopAudioPlayback();
    };
  }, [open, currentUser]);

  async function handleToggleRecordingFallback() {
    if (!currentUser) {
      onRequireAuth();
      return;
    }
    if (callState === 'recording') {
      stopMediaRecording();
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setCallError(t.voiceCallNoMicFallback);
      return;
    }
    try {
      setCallError('');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      recordedChunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const chunks = recordedChunksRef.current;
        recordedChunksRef.current = [];
        for (const track of stream.getTracks()) track.stop();
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;

        if (!chunks.length || !openRef.current) {
          setCallState('ready');
          return;
        }

        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        const reader = new FileReader();
        reader.onload = async () => {
          const parsed = extractAudioBase64Payload(typeof reader.result === 'string' ? reader.result : '');
          if (!parsed || !openRef.current) {
            setCallState('ready');
            return;
          }
          setCallState('thinking');
          try {
            const resp = await fetch('/api/transcribe', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(parsed)
            });
            const data = await resp.json().catch(() => null);
            const transcribed = typeof data?.text === 'string' ? data.text.trim() : '';
            if (transcribed) {
              await processUserUtterance(transcribed);
            } else {
              setCallError(t.voiceNoSpeechError);
              setCallState('ready');
            }
          } catch {
            setCallError(t.voiceGenericError);
            setCallState('ready');
          }
        };
        reader.readAsDataURL(blob);
      };

      setCallState('recording');
      recorder.start();
    } catch {
      setCallError(t.voiceCallNoMicFallback);
      setCallState('ready');
    }
  }

  function handleToggleMute() {
    const nextMuted = !muted;
    setMuted(nextMuted);
    mutedRef.current = nextMuted;
    if (nextMuted) {
      stopSpeechRecognition();
      if (callState !== 'speaking' && callState !== 'thinking') {
        setCallState('muted');
      }
    } else if (!busyRef.current) {
      if (micFallbackMode) {
        setCallState('ready');
      } else {
        startContinuousRecognition();
      }
    }
  }

  function handleToggleSpeaker() {
    const nextSpeaker = !speakerEnabled;
    setSpeakerEnabled(nextSpeaker);
    speakerRef.current = nextSpeaker;
    if (!nextSpeaker) {
      stopAudioPlayback();
      if (callState === 'speaking') {
        setCallState(muted ? 'muted' : (micFallbackMode ? 'ready' : 'listening'));
      }
    }
  }

  if (!open) return null;

  const statusText = (() => {
    if (!currentUser) return t.voiceCallAuthNotice;
    if (callState === 'connecting') return t.voiceCallConnecting;
    if (callState === 'listening') return t.voiceCallListening;
    if (callState === 'recording') return t.voiceCallRecording;
    if (callState === 'thinking') return t.voiceCallThinking;
    if (callState === 'speaking') return t.voiceCallSpeaking;
    if (callState === 'muted') return t.voiceCallMuted;
    return t.voiceCallReady;
  })();

  const canUseFallbackMic = typeof navigator !== 'undefined'
    && Boolean(navigator.mediaDevices?.getUserMedia)
    && typeof MediaRecorder !== 'undefined';

  const latestTurn = callHistory[callHistory.length - 1] || null;
  const isGlowing = callState === 'speaking' || callState === 'listening' || callState === 'recording';

  return (
    <div className="voice-call-inline-layer" data-testid="voice-call-modal">
      <div className={`voice-status-badge ${currentUser ? 'voice-status-active' : ''}`}>
        <span className="voice-status-dot" aria-hidden="true" />
        <span className="voice-status-text" role="status" aria-live="polite" data-testid="voice-call-status">
          {statusText}
        </span>

        {currentUser && (
          <span className="voice-status-timer" dir="ltr" data-testid="voice-call-timer">
            {formatCallDuration(elapsedSeconds)}
          </span>
        )}

        <div className="voice-status-actions">
          {!currentUser ? (
            <button
              type="button"
              className="voice-badge-cta"
              onClick={onRequireAuth}
            >
              {t.authLoginCta}
            </button>
          ) : (
            <>
              {micFallbackMode && canUseFallbackMic ? (
                <button
                  type="button"
                  className={`voice-badge-icon ${callState === 'recording' ? 'voice-badge-recording' : ''}`}
                  onClick={handleToggleRecordingFallback}
                  disabled={callState === 'thinking'}
                  aria-label={callState === 'recording' ? t.voiceCallRecordStop : t.voiceCallRecordStart}
                  title={callState === 'recording' ? t.voiceCallRecordStop : t.voiceCallRecordStart}
                >
                  <MicOnIcon />
                </button>
              ) : (
                <button
                  type="button"
                  className={`voice-badge-icon ${muted ? 'voice-badge-muted' : ''}`}
                  onClick={handleToggleMute}
                  aria-pressed={muted}
                  aria-label={muted ? t.voiceCallUnmute : t.voiceCallMute}
                  title={muted ? t.voiceCallUnmute : t.voiceCallMute}
                >
                  {muted ? <MicOffIcon /> : <MicOnIcon />}
                </button>
              )}

              <button
                type="button"
                className={`voice-badge-icon ${!speakerEnabled ? 'voice-badge-muted' : ''}`}
                onClick={handleToggleSpeaker}
                aria-pressed={!speakerEnabled}
                aria-label={speakerEnabled ? t.voiceCallSpeakerOff : t.voiceCallSpeakerOn}
                title={speakerEnabled ? t.voiceCallSpeakerOff : t.voiceCallSpeakerOn}
              >
                {speakerEnabled ? <SpeakerOnIcon /> : <SpeakerOffIcon />}
              </button>
            </>
          )}

          <button
            type="button"
            className="voice-badge-end"
            onClick={onClose}
            data-testid="voice-call-end-button"
            aria-label={t.voiceCallEnd}
            title={t.voiceCallEnd}
          >
            ×
          </button>
        </div>
      </div>

      <div className="voice-inline-center">
        <div
          ref={logoRef}
          className={`welcome-emblem-stage voice-inline-emblem ${isGlowing ? 'voice-emblem-speaking' : ''}`}
          data-testid="welcome-emblem-stage"
        >
          <div className="welcome-emblem-aura" aria-hidden="true" />
          <EmblemIcon className="welcome-emblem-svg" />
        </div>

        {(liveTranscript || latestTurn || callError) && (
          <div className="voice-inline-caption">
            {liveTranscript && (
              <p className="voice-caption-live">{liveTranscript}</p>
            )}
            {!liveTranscript && latestTurn && (
              <p className={`voice-caption-turn ${latestTurn.role === 'assistant' ? 'voice-caption-ai' : ''}`}>
                <strong>{latestTurn.role === 'user' ? t.userLabel : t.assistantLabel}:</strong> {latestTurn.text}
              </p>
            )}
            {callError && (
              <p className="voice-caption-error" role="alert">{callError}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

export default VoiceCallModal;
