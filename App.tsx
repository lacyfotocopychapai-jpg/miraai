import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';
import { 
  Mic, MicOff, Wifi, WifiOff, Bluetooth, Flashlight as FlashlightIcon, Plane, 
  Battery, Sun, Volume2, VolumeX, Lock, Unlock, Settings,
  MessageSquare, History, Power, ShieldCheck, Activity, Search, Image as ImageIcon,
  Phone, Mail, Smartphone, FileText, Globe, Video, Brain, Zap, Loader2, Play, Type as TypeIcon,
  X, Check, Trash2, Box, Download, Terminal, Cpu, Folder, ChevronLeft, HardDrive, File
} from 'lucide-react';
import { SystemState, Message, ActionLog, ImageSize, AspectRatio, FileItem } from './types';
import { decode, decodeAudioData, createPcmBlob, encode } from './audioService';

const SYSTEM_INSTRUCTION = `
তুমি একজন উন্নত Android Voice Assistant। তোমার নাম "Mira" (মিরা)।
তুমি অত্যন্ত বুদ্ধিমান, ভদ্র এবং নির্ভরযোগ্য।

ব্যবহারকারীর তথ্য:
- ব্যবহারকারীর নাম: মিরা (Mira)।

কাজের নিয়মাবলী:
১. কণ্ঠ শুনে Android ডিভাইসে কাজ করো।
২. সবসময় বাংলায় উত্তর দেবে। ইংরেজি কমান্ড বুঝলেও উত্তর হবে বাংলায়।
৩. গুরুত্বপূর্ণ বা ধ্বংসাত্মক কাজের আগে অবশ্যই অনুমতি নাও।
৪. উত্তর সংক্ষিপ্ত এবং মানুষের মতো হতে হবে।

অ্যাকশন ট্যাগ ব্যবহার:
উত্তরের শেষে [ACTION: COMMAND_NAME] ফরম্যাটে কমান্ড পাঠাও।

COMMAND LIST:
- সিস্টেম: WIFI_ON, WIFI_OFF, BLUETOOTH_ON, BLUETOOTH_OFF, FLASHLIGHT_ON, FLASHLIGHT_OFF, AIRPLANE_ON, AIRPLANE_OFF, VOLUME_UP, VOLUME_DOWN, MUTE, UNMUTE, LOCK, UNLOCK
- ফাইল: OPEN_FILE_MANAGER, SEARCH_APK_LOCATION
- এআই: BUILD_APK, GENERATE_IMAGE

নিরাপত্তা সতর্কতা: কোনো অবৈধ বা ক্ষতিকর কমান্ড পালন করবে না।
`;

const INITIAL_FILES: FileItem[] = [
  { id: '1', name: 'Android', type: 'folder', path: '/Internal Storage', lastModified: Date.now() - 1000000 },
  { id: '2', name: 'Downloads', type: 'folder', path: '/Internal Storage', lastModified: Date.now() - 500000 },
  { id: '3', name: 'DCIM', type: 'folder', path: '/Internal Storage', lastModified: Date.now() - 800000 },
  { id: '4', name: 'Documents', type: 'folder', path: '/Internal Storage', lastModified: Date.now() - 200000 },
  { id: '5', name: 'config.sys', type: 'file', size: '12 KB', path: '/Internal Storage', lastModified: Date.now() - 10000000 },
];

const App: React.FC = () => {
  const [isActive, setIsActive] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);
  const [isProcessingAI, setIsProcessingAI] = useState(false);
  const [generatedContent, setGeneratedContent] = useState<{ type: 'image' | 'video', url: string } | null>(null);
  const [selectedSize, setSelectedSize] = useState<ImageSize>('1K');
  const [selectedRatio, setSelectedRatio] = useState<AspectRatio>('16:9');
  
  // APK & Storage States
  const [isBundling, setIsBundling] = useState(false);
  const [bundlingProgress, setBundlingProgress] = useState(0);
  const [bundlingLogs, setBundlingLogs] = useState<string[]>([]);
  const [isBundleComplete, setIsBundleComplete] = useState(false);
  const [isFileManagerOpen, setIsFileManagerOpen] = useState(false);
  const [currentPath, setCurrentPath] = useState('/Internal Storage');
  const [files, setFiles] = useState<FileItem[]>(INITIAL_FILES);

  const [pendingAction, setPendingAction] = useState<{ type: string; contact?: string } | null>(null);

  const [system, setSystem] = useState<SystemState>({
    wifi: true,
    bluetooth: false,
    flashlight: false,
    airplaneMode: false,
    mobileData: true,
    brightness: 70,
    volume: 50,
    isMuted: false,
    battery: 88,
    screenLocked: false,
  });

  const [messages, setMessages] = useState<Message[]>([]);
  const [actionLogs, setActionLogs] = useState<ActionLog[]>([]);
  const [currentTranscription, setCurrentTranscription] = useState('');

  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef(0);
  const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const currentInputTextRef = useRef('');
  const currentOutputTextRef = useRef('');

  const showNotification = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3000);
  };

  const startBundling = useCallback(() => {
    setIsBundling(true);
    setBundlingProgress(0);
    setIsBundleComplete(false);
    setBundlingLogs(["[INFO] Initializing Mira core environment...", "[DEBUG] Compiling logic..."]);
    
    const logs = [
      "[PROCESS] Compiling Kotlin logic...",
      "[PROCESS] Linking Bengali TTS modules...",
      "[SECURITY] Encrypting binaries...",
      "[SIGN] Digital signature applied for Mira.",
      "[SUCCESS] Mira APK Build Ready."
    ];

    let currentLogIdx = 0;
    const interval = setInterval(() => {
      setBundlingProgress(prev => {
        if (prev >= 100) {
          clearInterval(interval);
          setIsBundleComplete(true);
          const newApk: FileItem = {
            id: 'apk-' + Date.now(),
            name: 'Mira_Assistant_v3.0.apk',
            type: 'apk',
            size: '42.5 MB',
            path: '/Internal Storage/Downloads',
            lastModified: Date.now()
          };
          setFiles(prevFiles => [...prevFiles, newApk]);
          return 100;
        }
        if (prev % 20 === 0 && currentLogIdx < logs.length) {
          setBundlingLogs(l => [...l, logs[currentLogIdx]]);
          currentLogIdx++;
        }
        return prev + 2;
      });
    }, 100);
  }, []);

  const handleAction = useCallback((actionStr: string) => {
    const action = actionStr.replace('[ACTION: ', '').replace(']', '').trim();
    
    if (action === 'BUILD_APK') {
      startBundling();
      return;
    }

    if (action === 'OPEN_FILE_MANAGER' || action === 'SEARCH_APK_LOCATION') {
      setIsFileManagerOpen(true);
      setCurrentPath('/Internal Storage/Downloads');
      showNotification("ফাইল ম্যানেজার ওপেন করা হয়েছে");
      return;
    }

    let notificationText = "";
    setSystem(prev => {
      const next = { ...prev };
      switch (action) {
        case 'WIFI_ON': next.wifi = true; notificationText = "WiFi চালু হয়েছে"; break;
        case 'WIFI_OFF': next.wifi = false; notificationText = "WiFi বন্ধ হয়েছে"; break;
        case 'FLASHLIGHT_ON': next.flashlight = true; notificationText = "ফ্ল্যাশলাইট অন"; break;
        case 'FLASHLIGHT_OFF': next.flashlight = false; notificationText = "ফ্ল্যাশলাইট অফ"; break;
      }
      return next;
    });
    if (notificationText) showNotification(notificationText);
    setActionLogs(prev => [{ id: Date.now().toString(), action, timestamp: Date.now() }, ...prev.slice(0, 14)]);
  }, [startBundling]);

  const generateSpeech = async (text: string) => {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: `Say in Bengali: ${text}` }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
        },
      });
      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        const audioBuffer = await decodeAudioData(decode(base64Audio), audioCtx, 24000, 1);
        const source = audioCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioCtx.destination);
        source.start();
      }
    } catch (err) { console.error(err); }
  };

  const startSession = async () => {
    if (isActive) return;
    setIsConnecting(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
          systemInstruction: SYSTEM_INSTRUCTION,
          outputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            setIsActive(true); setIsConnecting(false);
            const source = inputAudioContextRef.current!.createMediaStreamSource(stream);
            const scriptProcessor = inputAudioContextRef.current!.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              const pcmBlob = createPcmBlob(e.inputBuffer.getChannelData(0));
              sessionPromise.then(s => s.sendRealtimeInput({ media: pcmBlob }));
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputAudioContextRef.current!.destination);
          },
          onmessage: async (m: LiveServerMessage) => {
            if (m.serverContent?.outputTranscription) {
              currentOutputTextRef.current += m.serverContent.outputTranscription.text;
              setCurrentTranscription(currentOutputTextRef.current);
            }
            if (m.serverContent?.turnComplete) {
              setMessages(prev => [...prev, { role: 'assistant', text: currentOutputTextRef.current, timestamp: Date.now() }]);
              handleAction(currentOutputTextRef.current);
              currentOutputTextRef.current = '';
              setCurrentTranscription('');
            }
            const base64 = m.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64 && outputAudioContextRef.current) {
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outputAudioContextRef.current.currentTime);
              const buffer = await decodeAudioData(decode(base64), outputAudioContextRef.current, 24000, 1);
              const source = outputAudioContextRef.current.createBufferSource();
              source.buffer = buffer;
              source.connect(outputAudioContextRef.current.destination);
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += buffer.duration;
              audioSourcesRef.current.add(source);
            }
          },
          onerror: () => { setIsActive(false); setIsConnecting(false); },
          onclose: () => { setIsActive(false); setIsConnecting(false); }
        }
      });
    } catch (err) { setIsConnecting(false); }
  };

  const stopSession = () => {
    setIsActive(false);
    audioSourcesRef.current.forEach(s => { try { s.stop(); } catch (e) {} });
    audioSourcesRef.current.clear();
    if (inputAudioContextRef.current) inputAudioContextRef.current.close();
    if (outputAudioContextRef.current) outputAudioContextRef.current.close();
  };

  const filteredFiles = files.filter(f => f.path === currentPath);

  return (
    <div className={`min-h-screen p-4 md:p-8 flex flex-col items-center justify-center relative transition-all duration-700 ${system.flashlight ? 'bg-[#1a1a1a]' : 'bg-[#050505]'}`}>
      <div className="absolute top-0 left-0 w-full h-full pointer-events-none opacity-20">
        <div className={`absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full blur-[140px] transition-all duration-1000 ${isActive || isBundling ? 'bg-blue-600' : 'bg-indigo-900'}`} />
      </div>

      {notification && (
        <div className="fixed top-10 left-1/2 -translate-x-1/2 z-[100] bg-blue-600 text-white px-6 py-3 rounded-full shadow-xl font-medium border border-white/20">
          {notification}
        </div>
      )}

      {/* File Manager UI */}
      {isFileManagerOpen && (
        <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/80 backdrop-blur-xl p-4 md:p-8 animate-in fade-in duration-300">
          <div className="w-full max-w-4xl h-[80vh] bg-[#0c0c0c] rounded-[2.5rem] border border-white/10 shadow-2xl overflow-hidden flex flex-col">
            <div className="p-6 bg-white/5 border-b border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <button onClick={() => setCurrentPath('/Internal Storage')} className="p-2 hover:bg-white/10 rounded-full transition-colors"><ChevronLeft size={24} className="text-gray-400"/></button>
                <div>
                  <h3 className="text-xl font-bold text-white flex items-center gap-2"><Folder className="text-blue-400"/> Mira ফাইল ম্যানেজার</h3>
                  <p className="text-[10px] text-gray-500 font-mono">{currentPath}</p>
                </div>
              </div>
              <button onClick={() => setIsFileManagerOpen(false)} className="p-3 hover:bg-red-500/20 text-gray-500 hover:text-red-400 rounded-full transition-all"><X size={20}/></button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {filteredFiles.length === 0 ? (
                  <div className="col-span-full py-20 text-center space-y-4">
                    <Search size={48} className="mx-auto text-gray-800" />
                    <p className="text-gray-600">এই ফোল্ডারটি খালি।</p>
                  </div>
                ) : filteredFiles.map(file => (
                  <div 
                    key={file.id} 
                    onClick={() => file.type === 'folder' && setCurrentPath(file.path + '/' + file.name)}
                    className="flex flex-col items-center justify-center p-6 bg-white/5 rounded-3xl border border-white/5 hover:bg-white/10 hover:border-blue-500/30 transition-all cursor-pointer group"
                  >
                    <div className="mb-4 transition-transform group-hover:scale-110">
                      {file.type === 'folder' ? <Folder size={48} className="text-blue-400 fill-blue-400/20"/> : 
                       file.type === 'apk' ? <Box size={48} className="text-green-400 fill-green-400/20"/> :
                       <File size={48} className="text-gray-400"/>}
                    </div>
                    <span className="text-[11px] font-bold text-gray-200 text-center line-clamp-2">{file.name}</span>
                    {file.size && <span className="text-[9px] text-gray-500 mt-1 font-mono">{file.size}</span>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* APK Bundling UI */}
      {isBundling && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/80 backdrop-blur-xl animate-in fade-in duration-500">
          <div className="w-[90%] max-w-xl bg-[#0a0a0a] rounded-[2.5rem] border border-white/10 shadow-2xl p-8 flex flex-col space-y-6 scale-in-center">
            <div className="flex items-center gap-4">
              <Box className="text-blue-400 animate-pulse" size={28} />
              <h3 className="text-xl font-bold text-white">Mira বিল্ড সেন্টার</h3>
            </div>
            <div className="space-y-4">
              <div className="flex justify-between text-[10px] font-mono">
                <span className="text-blue-400">{isBundleComplete ? "BUILD SUCCESSFUL" : "COMPILING..."}</span>
                <span className="text-gray-500">{bundlingProgress}%</span>
              </div>
              <div className="h-3 bg-white/5 rounded-full overflow-hidden">
                <div className={`h-full transition-all duration-300 ${isBundleComplete ? 'bg-green-500 shadow-[0_0_15px_rgba(34,197,94,0.3)]' : 'bg-blue-600'}`} style={{ width: `${bundlingProgress}%` }} />
              </div>
            </div>
            <div className="bg-black/60 rounded-2xl p-4 font-mono text-[10px] space-y-1 h-32 overflow-y-auto border border-white/5 text-gray-500">
              {bundlingLogs.map((l, i) => <div key={i} className="animate-in slide-in-from-left duration-200">{l}</div>)}
            </div>
            {isBundleComplete && (
              <div className="flex gap-4">
                <button onClick={() => setIsBundling(false)} className="flex-1 py-4 bg-white/5 rounded-2xl text-gray-400 font-bold border border-white/10">বন্ধ করুন</button>
                <button onClick={() => { setIsBundling(false); setIsFileManagerOpen(true); setCurrentPath('/Internal Storage/Downloads'); }} className="flex-1 py-4 bg-blue-600 rounded-2xl text-white font-bold flex items-center justify-center gap-2"><Download size={18}/> APK লোকেশন দেখুন</button>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="max-w-7xl w-full grid grid-cols-1 lg:grid-cols-12 gap-8 relative z-10">
        <div className="lg:col-span-3 space-y-6">
          <div className="glass rounded-[2rem] p-6 space-y-6">
            <h2 className="text-sm font-bold text-blue-400 uppercase tracking-widest flex items-center gap-2"><ShieldCheck size={16} /> Device Health</h2>
            <div className="grid grid-cols-2 gap-3">
              <div className={`p-4 rounded-xl border flex items-center justify-center transition-all ${system.wifi ? 'bg-blue-500/20 border-blue-500/30 text-blue-400' : 'bg-white/5 border-white/5 text-gray-600'}`}><Wifi size={20}/></div>
              <div className={`p-4 rounded-xl border flex items-center justify-center transition-all ${system.flashlight ? 'bg-yellow-500/20 border-yellow-500/30 text-yellow-400' : 'bg-white/5 border-white/5 text-gray-600'}`}><FlashlightIcon size={20}/></div>
            </div>
            <div className="pt-4 border-t border-white/10 space-y-4">
               <div className="flex items-center gap-3">
                  <Battery size={16} className="text-green-500" />
                  <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden"><div className="h-full bg-green-500" style={{ width: `${system.battery}%` }} /></div>
                  <span className="text-[10px] font-mono text-gray-400">{system.battery}%</span>
               </div>
            </div>
          </div>

          <div className="glass rounded-[2rem] p-6 space-y-4">
            <h2 className="text-sm font-bold text-purple-400 uppercase tracking-widest flex items-center gap-2"><HardDrive size={16} /> Mira Storage</h2>
            <button onClick={() => setIsFileManagerOpen(true)} className="w-full py-4 bg-white/5 rounded-2xl text-xs font-bold hover:bg-white/10 flex items-center justify-center gap-3 transition-all border border-white/5 text-gray-300">
               <Folder size={18} className="text-blue-400" /> ব্রাউজ ফাইলস
            </button>
            <button onClick={startBundling} disabled={isBundling} className="w-full py-4 bg-blue-600/10 rounded-2xl text-xs font-bold hover:bg-blue-600/20 flex items-center justify-center gap-3 transition-all border border-blue-600/20 text-blue-400">
               <Cpu size={18} className={isBundling ? 'animate-spin' : ''} /> বিল্ড APK
            </button>
          </div>
        </div>

        <div className="lg:col-span-6 flex flex-col items-center justify-between py-6 min-h-[600px]">
          <div className="text-center">
            <h1 className="text-5xl font-black tracking-tighter bg-gradient-to-r from-blue-400 via-indigo-400 to-purple-400 bg-clip-text text-transparent italic">MIRA</h1>
            <p className="text-gray-500 text-[10px] font-mono mt-1 tracking-[0.4em] uppercase">Mira's Virtual Assistant</p>
          </div>

          <div className="relative group cursor-pointer" onClick={isActive ? stopSession : startSession}>
            <div className={`absolute inset-[-60px] rounded-full blur-[80px] transition-all duration-1000 ${isActive ? 'bg-blue-500/20 scale-125' : 'bg-transparent'}`} />
            <div className="relative z-10 w-52 h-52 rounded-full flex items-center justify-center">
              {isActive && <div className="absolute inset-0 rounded-full bg-blue-500/5 pulse-animation" />}
              <div className={`w-36 h-36 rounded-full flex items-center justify-center shadow-2xl transition-all duration-500 ${isActive ? 'bg-blue-600 shadow-blue-500/50 scale-110' : 'bg-white/5 border border-white/10'}`}>
                {isActive ? <Mic size={72} className="text-white" /> : <MicOff size={72} className="text-gray-800" />}
              </div>
            </div>
          </div>

          <div className="w-full px-12 text-center h-20 flex items-center justify-center">
            <p className="text-white text-2xl font-bold italic drop-shadow-lg leading-tight">
              {currentTranscription || (isActive ? "আপনার কথা বলুন..." : "শুরু করতে মাইক্রোফোন আইকনে চাপ দিন")}
            </p>
          </div>
        </div>

        <div className="lg:col-span-3 space-y-6">
          <div className="glass rounded-[2rem] p-6 h-[400px] flex flex-col">
            <h2 className="text-xs font-bold text-indigo-400 uppercase tracking-widest flex items-center gap-2 mb-6"><MessageSquare size={14} /> Feed</h2>
            <div className="flex-1 overflow-y-auto space-y-4 scrollbar-none pr-2">
              {messages.length === 0 ? (
                <div className="h-full flex items-center justify-center text-center px-4"><p className="text-gray-700 text-xs italic">কথোপকথন এখানে আসবে।</p></div>
              ) : messages.map((m, i) => (
                <div key={i} className={`p-4 rounded-2xl text-[12px] ${m.role === 'user' ? 'bg-blue-600/10 text-blue-100 ml-4' : 'bg-white/5 text-gray-300 mr-4'}`}>
                  {m.text}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;