import { useState, useRef, useEffect, useCallback } from 'react';

export function useGeminiLive() {
  const [isListening, setIsListening] = useState(false);
  const [status, setStatus] = useState('disconnected'); // disconnected, connected, processing, speaking
  const [error, setError] = useState(null);

  const wsRef = useRef(null);
  const audioContextRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const workletNodeRef = useRef(null);
  const disconnectedRef = useRef(true);  // Track intentional disconnect
  const welcomeTimerRef = useRef(null);  // Welcome message timer

  // Audio playback queue
  const audioQueue = useRef([]);
  const isPlayingRef = useRef(false);
  const chunkCountRef = useRef(0);

  const logStat = (msg) => {
    console.log(`[${new Date().toISOString().split('T')[1].slice(0, -1)}] 🤖 ${msg}`);
  }

  const updateStatus = (newStatus) => {
    // Don't update to connected/speaking/processing if we've disconnected
    if (disconnectedRef.current && newStatus !== 'disconnected') return;
    setStatus(prev => {
      if (prev !== newStatus) {
        logStat(`State -> ${newStatus.toUpperCase()}`);
      }
      return newStatus;
    });
  }

  const connect = useCallback(async () => {
    try {
      disconnectedRef.current = false;
      setError(null);
      updateStatus('connecting');
      wsRef.current = new WebSocket('wss://eatwise-backend-477953542175.us-central1.run.app/ws');

      wsRef.current.onopen = () => {
        logStat("WebSocket Connected");
        updateStatus('connected');
        startRecording();

        // Start welcome message timer — if no audio sent within 3s,
        // send a nudge to the agent so it greets the user
        welcomeTimerRef.current = setTimeout(() => {
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && !disconnectedRef.current) {
            logStat("No user input for 3s — sending welcome prompt");
            wsRef.current.send(JSON.stringify({
              text: "[SYSTEM] The user just connected but hasn't spoken yet. Please greet them with a brief welcome and explain how they can use you (voice queries, image uploads, barcode lookups). Keep it concise and friendly."
            }));
          }
        }, 3000);
      };

      wsRef.current.onmessage = async (event) => {
        // Clear welcome timer on any message from server (agent is already responding)
        if (welcomeTimerRef.current) {
          clearTimeout(welcomeTimerRef.current);
          welcomeTimerRef.current = null;
        }

        if (event.data instanceof Blob) {
          chunkCountRef.current++;
          if (!isPlayingRef.current) {
            updateStatus('processing');
            logStat(`Received first audio chunk (#${chunkCountRef.current})`);
          }
          const arrayBuffer = await event.data.arrayBuffer();
          playAudio(arrayBuffer);
        } else {
          try {
            const message = JSON.parse(event.data);
            if (message.type === 'interrupted') {
              logStat("🔴 SERVER SIGNAL: Interrupted! Cutting audio.");
              chunkCountRef.current = 0;
              stopPlayback();
            } else {
              logStat(`Server Msg: ${JSON.stringify(message)}`);
            }
          } catch (e) {
            console.log("Agent:", event.data);
          }
        }
      };

      wsRef.current.onclose = () => {
        logStat("WebSocket Closed");
        disconnectedRef.current = true;
        setIsListening(false);
        setStatus('disconnected');
        stopRecording();
        stopPlayback();
        if (welcomeTimerRef.current) {
          clearTimeout(welcomeTimerRef.current);
          welcomeTimerRef.current = null;
        }
      };

      wsRef.current.onerror = (e) => {
        logStat("WebSocket Error");
        setError('WebSocket error disconnected');
        disconnectedRef.current = true;
        setIsListening(false);
        setStatus('disconnected');
        stopRecording();
        if (welcomeTimerRef.current) {
          clearTimeout(welcomeTimerRef.current);
          welcomeTimerRef.current = null;
        }
      };
    } catch (err) {
      setError(err.message || 'Failed to connect');
      disconnectedRef.current = true;
    }
  }, []);

  const disconnect = useCallback(() => {
    logStat("User initiated disconnect");
    disconnectedRef.current = true;
    if (welcomeTimerRef.current) {
      clearTimeout(welcomeTimerRef.current);
      welcomeTimerRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    stopRecording();
    stopPlayback();
    setIsListening(false);
    setStatus('disconnected');
  }, []);

  const toggleMic = () => {
    if (isListening || status !== 'disconnected') {
      disconnect();
    } else {
      connect();
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 16000
      });

      const source = audioContextRef.current.createMediaStreamSource(stream);
      const processor = audioContextRef.current.createScriptProcessor(4096, 1, 1);

      processor.onaudioprocess = (e) => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && !disconnectedRef.current) {
          const inputData = e.inputBuffer.getChannelData(0);
          const pcmData = new Int16Array(inputData.length);
          for (let i = 0; i < inputData.length; i++) {
            pcmData[i] = Math.max(-32768, Math.min(32767, inputData[i] * 32768));
          }
          wsRef.current.send(JSON.stringify({ bytes: Array.from(new Uint8Array(pcmData.buffer)) }));

          // Clear welcome timer once user starts sending audio
          if (welcomeTimerRef.current) {
            clearTimeout(welcomeTimerRef.current);
            welcomeTimerRef.current = null;
          }
        }
      };

      source.connect(processor);
      processor.connect(audioContextRef.current.destination);

      setIsListening(true);
      logStat("Mic active, sending PCM stream...");
    } catch (err) {
      setError('Microphone access denied or audio setup failed.');
      disconnect();
    }
  };

  const stopRecording = () => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current) {
      try { audioContextRef.current.close(); } catch (e) { }
      audioContextRef.current = null;
    }
  };

  const playAudio = async (arrayBuffer) => {
    if (!audioContextRef.current || disconnectedRef.current) return;

    try {
      const int16Data = new Int16Array(arrayBuffer);
      const float32Data = new Float32Array(int16Data.length);
      for (let i = 0; i < int16Data.length; i++) {
        float32Data[i] = int16Data[i] / 32768.0;
      }

      const audioBuffer = audioContextRef.current.createBuffer(1, float32Data.length, 24000);
      audioBuffer.getChannelData(0).set(float32Data);

      audioQueue.current.push(audioBuffer);
      processQueue();
    } catch (e) {
      console.error('Audio processing error', e);
    }
  };

  const activeSourceRef = useRef(null);

  const processQueue = async () => {
    if (isPlayingRef.current || audioQueue.current.length === 0) return;

    isPlayingRef.current = true;
    updateStatus('speaking');

    while (audioQueue.current.length > 0 && !disconnectedRef.current) {
      const buffer = audioQueue.current.shift();
      if (!audioContextRef.current) break;
      const source = audioContextRef.current.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContextRef.current.destination);
      activeSourceRef.current = source;

      const playPromise = new Promise(resolve => {
        source.onended = resolve;
      });

      source.start();
      await playPromise;
    }

    isPlayingRef.current = false;
    activeSourceRef.current = null;
    chunkCountRef.current = 0;
    if (!disconnectedRef.current) {
      updateStatus('connected');
    }
  };

  const stopPlayback = () => {
    audioQueue.current = [];
    isPlayingRef.current = false;
    if (activeSourceRef.current) {
      try {
        activeSourceRef.current.stop();
      } catch (e) {
        // Ignore if already stopped
      }
      activeSourceRef.current = null;
    }
  };

  const sendText = useCallback((text) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      logStat(`Sending text: ${text.substring(0, 50)}...`);
      wsRef.current.send(JSON.stringify({ text }));
      // Clear welcome timer
      if (welcomeTimerRef.current) {
        clearTimeout(welcomeTimerRef.current);
        welcomeTimerRef.current = null;
      }
    }
  }, []);

  const sendImage = useCallback((base64Jpeg) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      logStat(`Sending image (${base64Jpeg.length} chars base64)`);
      wsRef.current.send(JSON.stringify({ image: base64Jpeg }));
      // Clear welcome timer
      if (welcomeTimerRef.current) {
        clearTimeout(welcomeTimerRef.current);
        welcomeTimerRef.current = null;
      }
    }
  }, []);

  return {
    isListening,
    status,
    error,
    toggleMic,
    sendText,
    sendImage
  };
}
