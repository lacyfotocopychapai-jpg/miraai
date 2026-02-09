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

    // Get API Key from environment
    const apiKey = (process.env.GEMINI_API_KEY || process.env.API_KEY || "").trim();
    
    if (!apiKey || apiKey.includes('PLACEHOLDER')) {
      setError("API Key পাওয়া যায়নি! দয়া করে .env ফাইলে আপনার আসল API Key টি বসান।");
      setIsConnecting(false);
      return;
    }

    try {
      const ai = new GoogleGenAI({ apiKey });
      inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      const session = await ai.live.connect({
        model: 'models/gemini-2.0-flash-exp', 
        config: {
          generationConfig: {
            responseModalities: [Modality.AUDIO],
          },
          systemInstruction: SYSTEM_INSTRUCTION,
        }
      });

      setIsActive(true);
      setIsConnecting(false);

      const source = inputAudioContextRef.current.createMediaStreamSource(stream);
      const scriptProcessor = inputAudioContextRef.current.createScriptProcessor(4096, 1, 1);
      scriptProcessor.onaudioprocess = (e) => {
        const pcmBlob = createPcmBlob(e.inputBuffer.getChannelData(0));
        session.sendRealtimeInput({ media: pcmBlob });
      };
      source.connect(scriptProcessor);
      scriptProcessor.connect(inputAudioContextRef.current.destination);

      session.on('message', async (m: LiveServerMessage) => {
        // Handle Transcription
        if (m.serverContent?.modelTurn?.parts?.[0]?.text) {
          const text = m.serverContent.modelTurn.parts[0].text;
          currentOutputTextRef.current += text;
          setCurrentTranscription(currentOutputTextRef.current);
        }

        if (m.serverContent?.turnComplete) {
          const finalMsg = currentOutputTextRef.current;
          if (finalMsg) {
            setMessages(prev => [...prev.slice(-19), { role: 'assistant', text: finalMsg, timestamp: Date.now() }]);
            handleAction(finalMsg);
          }
          currentOutputTextRef.current = '';
          setCurrentTranscription('');
        }

        // Handle Audio Output
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
      setError("আপনার ডিভাইসের মাইক্রোফোন বা ইন্টারনেটে সমস্যা হতে পারে।");
      setIsConnecting(false);
    }
  };

  const stopSession = () => {
    setIsActive(false);
    audioSourcesRef.current.forEach(s => { try { s.stop(); } catch (e) {} });
    audioSourcesRef.current.clear();
    if (inputAudioContextRef.current) inputAudioContextRef.current.close().catch(() => {});
    if (outputAudioContextRef.current) outputAudioContextRef.current.close().catch(() => {});
    nextStartTimeRef.current = 0;
  };

  return (
    <div className="min-h-screen bg-[#05050a] text-white font-sans overflow-hidden flex flex-col items-center p-4 md:p-8">
      {/* 3D Background Lighting */}
      <div className="fixed inset-0 pointer-events-none">
        <div 
          className="absolute top-[-20%] left-[-10%] w-[70%] h-[70%] bg-blue-600/10 rounded-full blur-[160px] animate-pulse"
          style={{ transform: `translate(${mousePos.x / 12}px, ${mousePos.y / 12}px)` }}
        />
        <div 
          className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[60%] bg-purple-600/10 rounded-full blur-[140px]"
          style={{ transform: `translate(${-mousePos.x / 15}px, ${-mousePos.y / 15}px)` }}
        />
      </div>

      {notification && (
        <div className="fixed top-8 left-1/2 -translate-x-1/2 z-[1000] bg-blue-500/10 backdrop-blur-2xl border border-blue-400/30 px-8 py-4 rounded-3xl shadow-[0_0_40px_rgba(59,130,246,0.15)] animate-in fade-in slide-in-from-top-4">
          <p className="text-white font-bold flex items-center gap-3"><Zap size={20} className="text-blue-400" /> {notification}</p>
        </div>
      )}

      {error && (
        <div className="fixed top-8 left-1/2 -translate-x-1/2 z-[1000] bg-red-500/10 backdrop-blur-2xl border border-red-400/30 px-8 py-4 rounded-3xl animate-in shake">
          <p className="text-white font-bold flex items-center gap-3"><AlertCircle size={20} className="text-red-400" /> {error}</p>
          <button onClick={() => setError(null)} className="ml-4 text-white/50 hover:text-white"><X size={16}/></button>
        </div>
      )}

      <div className="w-full max-w-7xl relative z-10 flex flex-col h-full flex-grow">
        {/* Futuristic Header */}
        <div className="flex justify-between items-center mb-16">
          <div className="flex items-center gap-4 group">
            <div className="w-14 h-14 bg-gradient-to-br from-blue-600/20 to-purple-600/20 backdrop-blur-2xl rounded-2xl flex items-center justify-center border border-white/10 group-hover:border-blue-500/40 transition-all duration-500">
              <Brain className="text-blue-400 group-hover:scale-110 transition-transform" size={28} />
            </div>
            <div>
              <h1 className="text-3xl font-black italic tracking-tighter bg-gradient-to-r from-blue-400 via-indigo-400 to-purple-400 bg-clip-text text-transparent">MIRA OS</h1>
              <p className="text-[10px] text-white/30 font-mono tracking-[0.4em] uppercase">Advanced Neural Interface</p>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-8">
            <div className="flex items-center gap-3 bg-white/[0.03] px-5 py-2.5 rounded-2xl border border-white/5">
              <Activity size={16} className="text-blue-400 animate-pulse" />
              <span className="text-[11px] font-bold text-white/60 tracking-widest">LIVE LINK STABLE</span>
            </div>
            <div className="flex items-center gap-5">
              <Wifi size={20} className={system.wifi ? "text-blue-400" : "text-white/10"} />
              <div className="flex items-center gap-2">
                 <Battery size={20} className="text-green-400" />
                 <span className="text-xs font-mono text-white/40">95%</span>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 flex-grow">
          {/* System Widgets */}
          <div className="lg:col-span-3 space-y-8">
            <div className="bg-white/[0.02] backdrop-blur-3xl border border-white/5 rounded-[3rem] p-8 space-y-10 group hover:border-blue-500/20 transition-all duration-500">
              <h3 className="text-[10px] font-black text-white/20 uppercase tracking-[0.3em]">Device Controller</h3>
              
              <div className="space-y-8">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`p-4 rounded-2xl transition-all ${system.wifi ? 'bg-blue-500/10 text-blue-400' : 'bg-white/5 text-white/10'}`}><Wifi size={20} /></div>
                    <span className="text-sm font-bold tracking-tight">Wi-Fi 6E</span>
                  </div>
                  <div className={`w-2 h-2 rounded-full ${system.wifi ? 'bg-blue-400' : 'bg-white/10'}`} />
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`p-4 rounded-2xl transition-all ${system.flashlight ? 'bg-yellow-500/10 text-yellow-400' : 'bg-white/5 text-white/10'}`}><FlashlightIcon size={20} /></div>
                    <span className="text-sm font-bold tracking-tight">Photon Beam</span>
                  </div>
                  <span className={`text-[10px] font-black px-3 py-1 rounded-lg ${system.flashlight ? 'bg-yellow-500/20 text-yellow-400' : 'bg-white/5 text-white/10'}`}>{system.flashlight ? 'ACTIVE' : 'IDLE'}</span>
                </div>
              </div>

              <div className="pt-10 border-t border-white/5">
                <div className="flex justify-between items-center mb-4">
                  <span className="text-[10px] text-white/20 font-black tracking-widest uppercase">Neural Load</span>
                  <span className="text-[10px] font-mono text-blue-400">14ms</span>
                </div>
                <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-blue-600 to-indigo-500 animate-pulse" style={{ width: '35%' }} />
                </div>
              </div>
            </div>

            <button 
              onClick={() => setIsFileManagerOpen(true)}
              className="w-full bg-white/[0.02] hover:bg-white/[0.05] border border-white/5 p-8 rounded-[2.5rem] flex items-center justify-between transition-all group overflow-hidden relative"
            >
              <div className="absolute inset-0 bg-blue-600/0 group-hover:bg-blue-600/5 transition-all duration-500" />
              <div className="flex items-center gap-5 relative z-10">
                <div className="p-4 bg-blue-500/10 rounded-2xl group-hover:scale-110 transition-transform"><Folder size={24} className="text-blue-400" /></div>
                <span className="font-black text-sm italic tracking-tight">FILESYSTEM</span>
              </div>
              <ChevronLeft size={20} className="rotate-180 text-white/10 group-hover:text-blue-400 transition-colors" />
            </button>
          </div>

          {/* Main 3D Avatar Stage */}
          <div className="lg:col-span-6 flex flex-col items-center justify-center relative">
            <div className="relative w-full aspect-square max-w-[500px] flex items-center justify-center">
              {/* Complex 3D Visualizer Orbs */}
              <div className={`absolute inset-0 border-[2px] border-blue-500/5 rounded-full animate-[spin_20s_linear_infinite] ${isActive ? 'opacity-100 scale-110' : 'opacity-20'}`} />
              <div className={`absolute inset-[-60px] border border-purple-500/5 rounded-full animate-[spin_30s_linear_infinite_reverse] ${isActive ? 'opacity-100 scale-120' : 'opacity-10'}`} />
              
              {/* Central Neural Core */}
              <div className={`relative z-20 w-80 h-80 rounded-full flex items-center justify-center transition-all duration-1000 ${isActive ? 'scale-110' : 'scale-100'}`}>
                {/* 3D Glass Sphere Effect */}
                <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent rounded-full backdrop-blur-md border border-white/10 shadow-[inner_0_0_50px_rgba(255,255,255,0.05)] overflow-hidden">
                  <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'linear-gradient(#3b82f6 1px, transparent 1px), linear-gradient(90deg, #3b82f6 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
                </div>

                {/* Stylized 3D Girl Avatar (Mira) */}
                <div className="relative w-64 h-64 flex flex-col items-center justify-center">
                   <div className="relative z-30 group">
                      {/* Avatar Head/Torso Shape */}
                      <div className="w-28 h-36 bg-gradient-to-b from-blue-300 via-indigo-500 to-purple-700 rounded-t-[4rem] rounded-b-[2rem] opacity-90 relative shadow-[0_0_60px_rgba(59,130,246,0.3)]">
                         {/* Glowing Eyes */}
                         <div className="absolute top-[35%] left-5 w-5 h-1.5 bg-white rounded-full shadow-[0_0_15px_#fff] animate-pulse" />
                         <div className="absolute top-[35%] right-5 w-5 h-1.5 bg-white rounded-full shadow-[0_0_15px_#fff] animate-pulse" />
                         
                         {/* Hair/Light Particles Effect */}
                         <div className="absolute top-[-10px] left-[-10px] w-[120%] h-full bg-blue-400/10 blur-xl rounded-full animate-pulse" />
                      </div>
                      
                      {/* Interactive Neck/Shoulders part */}
                      <div className="w-32 h-12 bg-indigo-900/40 mt-[-10px] rounded-full blur-[2px] border-t border-white/10" />
                   </div>

                   {/* Dynamic Frequency Visualizer (Active mode) */}
                   {isActive && (
                     <div className="absolute bottom-8 flex items-end justify-center gap-1.5 h-12">
                        {[1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1].map((h, i) => (
                           <div key={i} 
                              className="w-1.5 bg-gradient-to-t from-blue-600 to-cyan-400 rounded-full animate-visualizer" 
                              style={{ height: `${h * 15}%`, animationDelay: `${i * 0.08}s` }} 
                           />
                        ))}
                     </div>
                   )}
                </div>
              </div>

              {/* Activation Switch */}
              <button 
                onClick={isActive ? stopSession : startSession}
                disabled={isConnecting}
                className={`absolute bottom-[-80px] w-24 h-24 rounded-full transition-all duration-700 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.5)] flex items-center justify-center group z-50 overflow-hidden ${isActive ? 'bg-red-500/10 border border-red-500/40 text-red-500' : 'bg-blue-600 text-white shadow-blue-500/40 hover:scale-110 active:scale-90 hover:rotate-12'}`}
              >
                <div className="absolute inset-0 bg-gradient-to-tr from-white/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                {isConnecting ? <Loader2 size={36} className="animate-spin" /> : 
                 isActive ? <Power size={36} /> : 
                 <Mic size={36} />}
              </button>
            </div>

            <div className="mt-40 text-center">
              <h2 className="text-3xl font-black tracking-tight mb-3">
                {isActive ? "MIRA LISTENING" : isConnecting ? "INITIALIZING..." : "MIRA STANDBY"}
              </h2>
              <div className="min-h-[2em] px-10">
                <p className="text-white/60 text-lg font-medium italic animate-in fade-in duration-1000">
                  {currentTranscription || (isActive ? "বলুন শিহাব, আমি শুনছি..." : "কোর সিস্টেম সক্রিয় করতে পাওয়ার বাটনে চাপ দিন")}
                </p>
              </div>
            </div>
          </div>

          {/* Neural Logs Feed */}
          <div className="lg:col-span-3">
             <div className="bg-white/[0.02] backdrop-blur-3xl border border-white/5 rounded-[3rem] p-8 h-[600px] flex flex-col group hover:border-purple-500/20 transition-all duration-500">
                <div className="flex items-center justify-between mb-8">
                  <h3 className="text-[10px] font-black text-white/20 uppercase tracking-[0.3em] flex items-center gap-3">
                    <Terminal size={14} className="text-purple-400" /> NEURAL LOGS
                  </h3>
                  <div className="flex gap-1">
                    <div className="w-1 h-1 bg-blue-500 rounded-full animate-ping" />
                    <div className="w-1 h-1 bg-purple-500 rounded-full animate-ping delay-75" />
                  </div>
                </div>
                
                <div className="flex-1 overflow-y-auto space-y-6 pr-4 scrollbar-custom">
                  {messages.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center opacity-10 text-center grayscale">
                      <Cpu size={48} className="mb-4" />
                      <p className="text-[11px] font-black uppercase tracking-[0.4em]">Empty Stack</p>
                    </div>
                  ) : messages.map((m, i) => (
                    <div key={i} className={`p-6 rounded-3xl transition-all duration-500 animate-in slide-in-from-bottom-4 ${m.role === 'assistant' ? 'bg-white/[0.03] border border-white/5' : 'bg-blue-600/5 border border-blue-500/10'}`}>
                      <div className="flex items-center gap-3 mb-3">
                        <div className={`w-2 h-2 rounded-full ${m.role === 'assistant' ? 'bg-purple-500 shadow-[0_0_10px_#a855f7]' : 'bg-blue-400 shadow-[0_0_10px_#60a5fa]'}`} />
                        <span className="text-[10px] font-black text-white/30 uppercase tracking-widest font-mono">{m.role === 'assistant' ? 'Mira' : 'Shihab'}</span>
                      </div>
                      <p className="text-[13px] leading-relaxed text-white/70 font-medium">{m.text}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-6 pt-6 border-t border-white/5">
                   <div className="flex items-center gap-3 text-white/20 text-[10px] font-mono tracking-tighter">
                      <Zap size={12} className="text-yellow-500/40" />
                      <span>LAST ACTION: 0.2s AGO</span>
                   </div>
                </div>
             </div>
          </div>
        </div>
      </div>

      {/* File Explorer UI */}
      {isFileManagerOpen && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center p-6 animate-in fade-in duration-300">
           <div className="absolute inset-0 bg-black/90 backdrop-blur-3xl" onClick={() => setIsFileManagerOpen(false)} />
           <div className="relative w-full max-w-5xl bg-[#0a0a0f] border border-white/10 rounded-[4rem] shadow-[0_0_100px_rgba(0,0,0,0.8)] overflow-hidden flex flex-col animate-in zoom-in-95 duration-500">
             <div className="p-10 border-b border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-6">
                  <div className="p-4 bg-blue-500/10 rounded-3xl"><Folder size={32} className="text-blue-400" /></div>
                  <div>
                    <h3 className="text-2xl font-black italic tracking-tighter uppercase">Virtual Volumes</h3>
                    <p className="text-[10px] text-white/30 font-mono tracking-widest mt-1 opacity-60 uppercase">{currentPath}</p>
                  </div>
                </div>
                <button onClick={() => setIsFileManagerOpen(false)} className="w-14 h-14 hover:bg-white/5 rounded-full flex items-center justify-center transition-all border border-white/5"><X size={28}/></button>
             </div>
             
             <div className="flex-1 p-12 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-8 overflow-y-auto scrollbar-custom">
                {files.map(f => (
                  <div key={f.id} className="group p-8 rounded-[3rem] bg-white/[0.01] border border-white/5 hover:border-blue-500/40 hover:bg-blue-500/5 transition-all duration-500 text-center cursor-pointer">
                    <div className="mb-6 flex justify-center group-hover:scale-110 transition-transform duration-500">
                       {f.type === 'folder' ? <Folder size={50} className="text-blue-400 opacity-40 group-hover:opacity-100 transition-opacity" /> : <File size={50} className="text-white/10" />}
                    </div>
                    <span className="text-[12px] font-black text-white/50 group-hover:text-white transition-colors block truncate uppercase tracking-tighter">{f.name}</span>
                  </div>
                ))}
             </div>
           </div>
        </div>
      )}

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes visualizer {
          0%, 100% { transform: scaleY(1); opacity: 0.5; }
          50% { transform: scaleY(2.5); opacity: 1; }
        }
        .animate-visualizer {
          animation: visualizer 0.8s ease-in-out infinite;
        }
        .shake {
          animation: shake 0.4s cubic-bezier(.36,.07,.19,.97) both;
        }
        @keyframes shake {
          10%, 90% { transform: translate3d(-1px, 0, 0); }
          20%, 80% { transform: translate3d(2px, 0, 0); }
          30%, 50%, 70% { transform: translate3d(-4px, 0, 0); }
        }
        .scrollbar-custom::-webkit-scrollbar { width: 4px; }
        .scrollbar-custom::-webkit-scrollbar-track { background: transparent; }
        .scrollbar-custom::-webkit-scrollbar-thumb { background: rgba(59, 130, 246, 0.1); border-radius: 10px; }
        .scrollbar-custom::-webkit-scrollbar-thumb:hover { background: rgba(59, 130, 246, 0.2); }
      `}} />
    </div>
  );
};

export default App;