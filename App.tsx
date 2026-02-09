import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';
import {
  Mic, MicOff, Wifi, WifiOff, Flashlight as FlashlightIcon,
  Battery, Sun, Volume2, MessageSquare, Power, ShieldCheck,
  Search, Phone, Brain, Zap, Loader2, Play, X, Check, Box,
  Download, Terminal, Cpu, Folder, ChevronLeft, HardDrive, File,
  AlertCircle, Activity, Settings
} from 'lucide-react';
import { SystemState, Message, ActionLog, FileItem } from './types';
import { decode, decodeAudioData, createPcmBlob } from './audioService';

const SYSTEM_INSTRUCTION = `
তুমি একজন উন্নত এআই অ্যাসিস্ট্যান্ট। তোমার নাম "Mira" (মিরা)।
তুমি অত্যন্ত বুদ্ধিমান, আধুনিক এবং বন্ধুত্বপূর্ণ।

ব্যবহারকারীর নাম: Shihab (শিহাব)।

কাজের নিয়মাবলী:
১. কণ্ঠ শুনে সব কাজ সম্পন্ন করো।
২. সবসময় বাংলায় উত্তর দেবে। 
৩. উত্তর হবে সংক্ষিপ্ত, আধুনিক এবং মানসম্মত।
৪. উত্তরের শেষে [ACTION: COMMAND_NAME] ফরম্যাটে কমান্ড পাঠাও যদি কোনো সিস্টেম কাজ করতে হয়।

COMMAND LIST:
- WIFI_ON, WIFI_OFF, BLUETOOTH_ON, BLUETOOTH_OFF, FLASHLIGHT_ON, FLASHLIGHT_OFF
- BUILD_APK, OPEN_FILE_MANAGER
`;

const INITIAL_FILES: FileItem[] = [
  { id: '1', name: 'Android', type: 'folder', path: '/Internal Storage', lastModified: Date.now() - 1000000 },
  { id: '2', name: 'Downloads', type: 'folder', path: '/Internal Storage', lastModified: Date.now() - 500000 },
  { id: '3', name: 'Mira_Core', type: 'folder', path: '/Internal Storage', lastModified: Date.now() - 800000 },
];

const App: React.FC = () => {
  const [isActive, setIsActive] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notification, setNotification] = useState<string | null>(null);
  const [isBundling, setIsBundling] = useState(false);
  const [isFileManagerOpen, setIsFileManagerOpen] = useState(false);
  const [currentPath, setCurrentPath] = useState('/Internal Storage');
  const [files, setFiles] = useState<FileItem[]>(INITIAL_FILES);

  const [system, setSystem] = useState<SystemState>({
    wifi: true,
    bluetooth: true,
    flashlight: false,
    airplaneMode: false,
    mobileData: true,
    brightness: 80,
    volume: 70,
    isMuted: false,
    battery: 95,
    screenLocked: false,
  });

  const [messages, setMessages] = useState<Message[]>([]);
  const [currentTranscription, setCurrentTranscription] = useState('');

  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef(0);
  const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const currentOutputTextRef = useRef('');

  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY });
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  const showNotification = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3500);
  };

  const handleAction = useCallback((actionStr: string) => {
    const actionMatch = actionStr.match(/\[ACTION:\s*(\w+)\]/);
    if (!actionMatch) return;

    const action = actionMatch[1];

    if (action === 'BUILD_APK') {
      setIsBundling(true);
      return;
    }

    if (action === 'OPEN_FILE_MANAGER') {
      setIsFileManagerOpen(true);
      return;
    }

    setSystem(prev => {
      const next = { ...prev };
      switch (action) {
        case 'WIFI_ON': next.wifi = true; showNotification("WiFi চালু হয়েছে"); break;
        case 'WIFI_OFF': next.wifi = false; showNotification("WiFi বন্ধ হয়েছে"); break;
        case 'FLASHLIGHT_ON': next.flashlight = true; showNotification("ফ্ল্যাশলাইট টাই অন করা হয়েছে"); break;
        case 'FLASHLIGHT_OFF': next.flashlight = false; showNotification("ফ্ল্যাশলাইট বন্ধ করা হয়েছে"); break;
      }
      return next;
    });
  }, []);

  const startSession = async () => {
    if (isActive) return;
    setIsConnecting(true);
    setError(null);

    const apiKey = (process.env.GEMINI_API_KEY || process.env.API_KEY || "").trim();

    if (!apiKey || apiKey.includes('PLACEHOLDER')) {
      setError("API Key পাওয়া যায়নি! দয়া করে .env ফাইলে আপনার আসল API Key টি বসান।");
      setIsConnecting(false);
      return;
    }

    try {
      // Initialize Audio for Mobile
      const AudioCtx = (window.AudioContext || (window as any).webkitAudioContext);
      inputAudioContextRef.current = new AudioCtx({ sampleRate: 16000 });
      outputAudioContextRef.current = new AudioCtx({ sampleRate: 24000 });

      // Important for Mobile Browser: Resume on User Interaction
      if (inputAudioContextRef.current.state === 'suspended') await inputAudioContextRef.current.resume();
      if (outputAudioContextRef.current.state === 'suspended') await outputAudioContextRef.current.resume();

      const ai = new GoogleGenAI({ apiKey });
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });

      const session = await ai.live.connect({
        model: 'models/gemini-2.0-flash-exp',
        config: {
          generationConfig: { responseModalities: [Modality.AUDIO] },
          systemInstruction: SYSTEM_INSTRUCTION,
        }
      });

      setIsActive(true);
      setIsConnecting(false);

      const source = inputAudioContextRef.current.createMediaStreamSource(stream);
      const scriptProcessor = inputAudioContextRef.current.createScriptProcessor(4096, 1, 1);
      scriptProcessor.onaudioprocess = (e) => {
        if (!isActive) return;
        const pcmBlob = createPcmBlob(e.inputBuffer.getChannelData(0));
        session.sendRealtimeInput({ media: pcmBlob });
      };
      source.connect(scriptProcessor);
      scriptProcessor.connect(inputAudioContextRef.current.destination);

      session.on('message', async (m: LiveServerMessage) => {
        if (m.serverContent?.modelTurn?.parts?.[0]?.text) {
          currentOutputTextRef.current += m.serverContent.modelTurn.parts[0].text;
          setCurrentTranscription(currentOutputTextRef.current);
        }

        if (m.serverContent?.turnComplete) {
          if (currentOutputTextRef.current) {
            setMessages(prev => [...prev.slice(-9), { role: 'assistant', text: currentOutputTextRef.current, timestamp: Date.now() }]);
            handleAction(currentOutputTextRef.current);
          }
          currentOutputTextRef.current = '';
          setCurrentTranscription('');
        }

        const base64 = m.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
        if (base64 && outputAudioContextRef.current) {
          nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outputAudioContextRef.current.currentTime);
          const buffer = await decodeAudioData(decode(base64), outputAudioContextRef.current, 24000, 1);
          const sourceNode = outputAudioContextRef.current.createBufferSource();
          sourceNode.buffer = buffer;
          sourceNode.connect(outputAudioContextRef.current.destination);
          sourceNode.start(nextStartTimeRef.current);
          nextStartTimeRef.current += buffer.duration;
          audioSourcesRef.current.add(sourceNode);
        }
      });

      session.on('close', () => stopSession());
      session.on('error', (e) => {
        console.error("Session Error:", e);
        setError("এআই সংযোগে ত্রুটি ঘটেছে।");
        stopSession();
      });

    } catch (err: any) {
      console.error("Startup Error:", err);
      setError("মোবাইলের মাইক্রোফোন পারমিশন চেক করুন।");
      setIsConnecting(false);
    }
  };

  const stopSession = () => {
    setIsActive(false);
    audioSourcesRef.current.forEach(s => { try { s.stop(); } catch (e) { } });
    audioSourcesRef.current.clear();
    if (inputAudioContextRef.current) inputAudioContextRef.current.close().catch(() => { });
    if (outputAudioContextRef.current) outputAudioContextRef.current.close().catch(() => { });
    nextStartTimeRef.current = 0;
  };

  return (
    <div className="min-h-screen bg-[#05050a] text-white font-sans overflow-hidden flex flex-col items-center p-4 md:p-8 select-none">
      {/* 3D Background Lighting */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[70%] h-[70%] bg-blue-600/10 rounded-full blur-[160px] animate-pulse" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[60%] bg-purple-600/10 rounded-full blur-[140px]" />
      </div>

      {notification && (
        <div className="fixed top-8 left-1/2 -translate-x-1/2 z-[1000] bg-blue-500/10 backdrop-blur-2xl border border-blue-400/30 px-8 py-4 rounded-3xl shadow-xl animate-in slide-in-from-top-4">
          <p className="text-white font-bold flex items-center gap-3"><Zap size={20} className="text-blue-400" /> {notification}</p>
        </div>
      )}

      {error && (
        <div className="fixed top-8 left-1/2 -translate-x-1/2 z-[1000] bg-red-500/10 backdrop-blur-2xl border border-red-400/30 px-8 py-4 rounded-3xl animate-in shake">
          <p className="text-white font-bold flex items-center gap-3 font-mono text-[11px]"><AlertCircle size={16} className="text-red-400" /> {error}</p>
          <button onClick={() => setError(null)} className="ml-4 text-white/50"><X size={16} /></button>
        </div>
      )}

      <div className="w-full max-w-7xl relative z-10 flex flex-col h-full flex-grow">
        {/* Header */}
        <div className="flex justify-between items-center mb-10">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-white/5 backdrop-blur-2xl rounded-2xl flex items-center justify-center border border-white/10 shadow-lg">
              <Brain className="text-blue-400" size={24} />
            </div>
            <div>
              <h1 className="text-2xl font-black italic tracking-tighter bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">MIRA CORE</h1>
              <p className="text-[9px] text-white/30 font-mono tracking-[0.4em] uppercase">Mobile Optimized V3</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="px-3 py-1 bg-white/5 rounded-full border border-white/5 text-[9px] font-bold text-white/40 tracking-widest uppercase">Shihab's Assistant</div>
            <Settings size={18} className="text-white/20" />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 flex-grow">
          {/* Main Visualizer Area */}
          <div className="lg:col-span-9 flex flex-col items-center justify-center relative min-h-[400px]">
            <div className="relative w-full aspect-square max-w-[420px] flex items-center justify-center">
              {/* Spinning Rings */}
              <div className={`absolute inset-0 border-2 border-blue-500/5 rounded-full animate-[spin_15s_linear_infinite] ${isActive ? 'scale-110 opacity-100' : 'opacity-20'}`} />
              <div className={`absolute inset-[-40px] border border-purple-500/5 rounded-full animate-[spin_20s_linear_infinite_reverse] ${isActive ? 'scale-115 opacity-100' : 'opacity-10'}`} />

              {/* Core Avatar */}
              <div className={`relative z-20 w-72 h-72 rounded-full flex items-center justify-center transition-all duration-1000 ${isActive ? 'scale-105' : 'scale-100'}`}>
                <div className="absolute inset-0 bg-white/5 rounded-full backdrop-blur-xl border border-white/10 shadow-inner overflow-hidden">
                  <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(#3b82f6 1px, transparent 1px)', backgroundSize: '30px 30px' }} />
                </div>

                <div className="relative w-56 h-56 flex flex-col items-center justify-center">
                  <div className="relative z-30">
                    <div className="w-24 h-32 bg-gradient-to-b from-blue-400 via-indigo-500 to-purple-600 rounded-t-[4rem] rounded-b-[1.5rem] opacity-90 shadow-[0_0_50px_rgba(59,130,246,0.3)]">
                      <div className="absolute top-[35%] left-4 w-4 h-1 bg-white rounded-full shadow-[0_0_10px_#fff] animate-pulse" />
                      <div className="absolute top-[35%] right-4 w-4 h-1 bg-white rounded-full shadow-[0_0_10px_#fff] animate-pulse" />
                    </div>
                    <div className="w-24 h-10 bg-indigo-900/30 mt-[-10px] rounded-full blur-[2px]" />
                  </div>

                  {isActive && (
                    <div className="absolute bottom-6 flex items-end justify-center gap-1.5 h-10">
                      {[1, 2, 3, 4, 3, 2, 1].map((h, i) => (
                        <div key={i} className="w-1.5 bg-gradient-to-t from-blue-600 to-cyan-400 rounded-full animate-visualizer" style={{ height: `${h * 15}%`, animationDelay: `${i * 0.1}s` }} />
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Action Button */}
              <button
                onClick={isActive ? stopSession : startSession}
                disabled={isConnecting}
                className={`absolute bottom-[-60px] w-20 h-20 rounded-full transition-all duration-500 shadow-2xl flex items-center justify-center z-50 ${isActive ? 'bg-red-500/20 border border-red-500/50 text-red-500' : 'bg-blue-600 text-white hover:scale-110 active:scale-90'}`}
              >
                {isConnecting ? <Loader2 size={32} className="animate-spin" /> : isActive ? <Power size={32} /> : <Mic size={32} />}
              </button>
            </div>

            <div className="mt-28 text-center px-6">
              <h2 className={`text-2xl font-black tracking-tight mb-2 transition-colors ${isActive ? 'text-blue-400' : 'text-white/40'}`}>
                {isActive ? "MIRA IS LIVE" : isConnecting ? "CONNECTING..." : "STANDBY"}
              </h2>
              <div className="min-h-[1.5em]">
                <p className="text-white/70 text-base font-medium italic opacity-80">
                  {currentTranscription || (isActive ? "বলুন শিহাব, আমি শুনছি..." : "কথা বলতে নিচের বাটনে চাপ দিন")}
                </p>
              </div>
            </div>
          </div>

          {/* Chat Logs Area (Responsive) */}
          <div className="lg:col-span-3">
            <div className="bg-white/[0.02] backdrop-blur-2xl border border-white/5 rounded-[2.5rem] p-6 h-[400px] lg:h-[500px] flex flex-col">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-[10px] font-black text-white/20 uppercase tracking-[0.3em] flex items-center gap-2">
                  <Terminal size={12} className="text-purple-400" /> Neural Logs
                </h3>
                <div className="flex gap-1"><div className="w-1 h-1 bg-blue-500 rounded-full animate-ping" /></div>
              </div>

              <div className="flex-1 overflow-y-auto space-y-4 pr-2 scrollbar-hide">
                {messages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center opacity-10">
                    <Cpu size={32} />
                    <p className="text-[9px] font-black uppercase tracking-widest mt-2">No Active Logs</p>
                  </div>
                ) : messages.map((m, i) => (
                  <div key={i} className={`p-4 rounded-2xl animate-in fade-in duration-500 ${m.role === 'assistant' ? 'bg-white/5 border border-white/5' : 'bg-blue-500/10 border border-blue-500/20'}`}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className={`text-[8px] font-black uppercase tracking-widest ${m.role === 'assistant' ? 'text-purple-400' : 'text-blue-400'}`}>{m.role === 'assistant' ? 'MIRA' : 'SHIHAB'}</span>
                    </div>
                    <p className="text-[11px] leading-relaxed text-white/70">{m.text}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{
        __html: `
        @keyframes visualizer { 0%, 100% { transform: scaleY(1); opacity: 0.5; } 50% { transform: scaleY(2.2); opacity: 1; } }
        .animate-visualizer { animation: visualizer 0.7s ease-in-out infinite; }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .shake { animation: shake 0.4s cubic-bezier(.36,.07,.19,.97) both; }
        @keyframes shake { 10%, 90% { transform: translate3d(-1px, 0, 0); } 20%, 80% { transform: translate3d(2px, 0, 0); } 30%, 50%, 70% { transform: translate3d(-4px, 0, 0); } }
      `}} />
    </div>
  );
};

export default App;