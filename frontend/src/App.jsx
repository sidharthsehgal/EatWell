import { useState, useRef, useEffect } from 'react';
import { Mic, Volume2, Loader, Camera, Upload, ShieldCheck, Info, X, Scan, Send, Search } from 'lucide-react';
import { useGeminiLive } from './hooks/useGeminiLive';
import './index.css';

/* ── Camera Overlay ── */
const CameraPreview = ({ onCapture, onClose }) => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    let stream = null;
    const startCamera = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' }
        });
        if (videoRef.current) videoRef.current.srcObject = stream;
      } catch (err) {
        console.error("Camera error:", err);
      }
    };
    startCamera();
    return () => { if (stream) stream.getTracks().forEach(t => t.stop()); };
  }, []);

  const capture = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    canvasRef.current.width = videoRef.current.videoWidth;
    canvasRef.current.height = videoRef.current.videoHeight;
    ctx.drawImage(videoRef.current, 0, 0);
    const base64 = canvasRef.current.toDataURL('image/jpeg', 0.85).split(',')[1];
    onCapture(base64);
  };

  return (
    <div className="camera-overlay">
      <div className="camera-container">
        <video ref={videoRef} autoPlay playsInline />
        <canvas ref={canvasRef} style={{ display: 'none' }} />
        <div className="camera-controls">
          <button className="btn btn-circle" onClick={onClose}><X size={20} /></button>
          <button className="btn btn-capture" onClick={capture}>
            <div className="capture-inner" />
          </button>
          <div style={{ width: 44 }} />
        </div>
      </div>
    </div>
  );
};

/* ── Status Badge ── */
const StatusBadge = ({ status }) => {
  const config = {
    disconnected: { label: 'Offline', className: 'offline' },
    connected:    { label: 'Listening', className: 'listening' },
    processing:   { label: 'Processing', className: 'processing' },
    speaking:     { label: 'Speaking', className: 'speaking' },
  };
  const { label, className } = config[status] || config.disconnected;

  return (
    <div className={`status-badge ${className}`}>
      <span className="status-dot" />
      {label}
    </div>
  );
};

/* ── App ── */
export default function App() {
  const [showCamera, setShowCamera] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [textQuery, setTextQuery] = useState('');
  const fileInputRef = useRef(null);

  const { isListening, status, error: audioError, toggleMic, sendText, sendImage } = useGeminiLive();

  useEffect(() => {
    if (audioError) addToast(audioError, 'error');
  }, [audioError]);

  const addToast = (message, type = 'info') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  };

  const handleImageCapture = (base64Jpeg) => {
    if (!isListening) { addToast('Start mic first to connect.', 'error'); return; }
    sendImage(base64Jpeg);
    addToast('Image sent to agent', 'info');
    setShowCamera(false);
  };

  const handleFileUpload = (file) => {
    if (!file) return;
    if (!isListening) { addToast('Start mic first to connect.', 'error'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      sendImage(reader.result.split(',')[1]);
      addToast('Image sent to agent', 'info');
    };
    reader.readAsDataURL(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleTextSubmit = () => {
    const q = textQuery.trim();
    if (!q) return;
    if (!isListening) { addToast('Start mic first to connect.', 'error'); return; }
    sendText(`[USER TEXT INPUT] The user typed the following product name, description, or product page URL. Please look it up, identify the product and its ingredients, then evaluate against their dietary profile: ${q}`);
    addToast('Sent to agent', 'info');
    setTextQuery('');
  };

  const isActive = status !== 'disconnected';

  return (
    <div className="app-container">
      <header>
        <h1>EatWise AI</h1>
        <p>Your personal food safety assistant</p>
      </header>

      {/* Voice Panel */}
      <section className={`panel voice-panel ${isActive ? 'active' : ''}`}>
        <div className="orb-container">
          <div className={`orb-ring ${status}`} />
          <button
            className={`mic-btn ${status !== 'disconnected' ? status : ''}`}
            onClick={toggleMic}
            aria-label={isListening ? 'Disconnect' : 'Start listening'}
          >
            {status === 'speaking' ? <Volume2 size={28} /> :
             status === 'processing' ? <Loader size={28} className="spin-icon" /> :
             <Mic size={28} />}
          </button>
        </div>

        <div className="status-area">
          <StatusBadge status={status} />
          <p className="status-hint">
            {!isActive
              ? 'Tap the mic to connect'
              : 'Say your allergies, ask about a food, or share a photo'}
          </p>
          {isActive && (
            <p className="disconnect-hint">Tap the icon above to disconnect</p>
          )}
        </div>
      </section>

      {/* Product Input Panel */}
      <section className="panel">
        <h2 className="panel-title">
          <Search size={16} color="var(--accent-secondary)" />
          Product Lookup
        </h2>
        <p className="scan-hint">
          Type a product name, description, or paste a product page URL.
          Or capture / upload a product photo, ingredient label, or barcode.
        </p>

        {/* Text input */}
        <div className="text-input-group">
          <input
            type="text"
            className="text-input"
            placeholder="e.g. Nutella, or paste a product URL..."
            value={textQuery}
            onChange={(e) => setTextQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleTextSubmit()}
            disabled={!isListening}
          />
          <button
            className="btn btn-send"
            onClick={handleTextSubmit}
            disabled={!isListening || !textQuery.trim()}
            aria-label="Send"
          >
            <Send size={18} />
          </button>
        </div>

        {/* Image actions */}
        <div className="image-actions">
          <button className="btn btn-primary" onClick={() => setShowCamera(true)} disabled={!isListening}>
            <Camera size={18} />
            Camera
          </button>
          <button className="btn" onClick={() => fileInputRef.current?.click()} disabled={!isListening}>
            <Upload size={18} />
            Upload
          </button>
          <input
            type="file"
            accept="image/*"
            className="hidden-input"
            ref={fileInputRef}
            onChange={(e) => handleFileUpload(e.target.files[0])}
          />
        </div>
      </section>

      <footer>
        <ShieldCheck size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
        Powered by Gemini Live API · google-genai SDK
      </footer>

      {showCamera && (
        <CameraPreview
          onCapture={handleImageCapture}
          onClose={() => setShowCamera(false)}
        />
      )}

      <div className="toast-container">
        {toasts.map(toast => (
          <div key={toast.id} className={`toast ${toast.type}`}>
            <Info size={16} />
            {toast.message}
          </div>
        ))}
      </div>
    </div>
  );
}
