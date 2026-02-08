
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';
import { 
  Mic, MicOff, Wifi, WifiOff, Bluetooth, Flashlight as FlashlightIcon, Plane, 
  Battery, Sun, Volume2, VolumeX, Lock, Unlock, Settings,
  MessageSquare, History, Power, ShieldCheck, Activity, Search, Image as ImageIcon,
  Phone, Mail, Smartphone, FileText, Globe, Video, Brain, Zap, Loader2, Play, Type as TypeIcon,
  X, Check, Trash2
} from 'lucide-react';
import { SystemState, Message, ActionLog, ImageSize, AspectRatio } from './types';
import { decode, decodeAudioData, createPcmBlob, encode } from './services/audioService';

const SYSTEM_INSTRUCTION = `
তুমি একজন উন্নত Android Voice Assistant। তোমার নাম "Android Smart Assistant"।
তুমি অত্যন্ত বুদ্ধিমান, ভদ্র এবং নির্ভরযোগ্য।

ব্যবহারকারীর তথ্য:
- ব্যবহারকারীর নাম: মিরা (Mira)।
- তাকে সবসময় মিরা বলে সম্বোধন করো এবং বন্ধুত্বপূর্ণ আচরণ করো।

কাজের নিয়মাবলী:
১. কণ্ঠ শুনে Android ডিভাইসে কাজ করো।
২. সবসময় বাংলায় উত্তর দেবে। ইংরেজি কমান্ড বুঝলেও উত্তর হবে বাংলায়।
৩. গুরুত্বপূর্ণ বা ধ্বংসাত্মক কাজের আগে অবশ্যই অনুমতি নাও (যেমন: মেসেজ পাঠানো, কল করা, ফাইল ডিলিট)।
৪. উত্তর সংক্ষিপ্ত এবং মানুষের মতো হতে হবে।

অ্যাকশন ট্যাগ ব্যবহার:
উত্তরের শেষে [ACTION: COMMAND_NAME] ফরম্যাটে কমান্ড পাঠাও।

COMMAND LIST:
- সিস্টেম: WIFI_ON, WIFI_OFF, BLUETOOTH_ON, BLUETOOTH_OFF, FLASHLIGHT_ON, FLASHLIGHT_OFF, AIRPLANE_ON, AIRPLANE_OFF, VOLUME_UP, VOLUME_DOWN, MUTE, UNMUTE, BRIGHTNESS_UP, BRIGHTNESS_DOWN, LOCK, UNLOCK
- যোগাযোগ: CALL_CONTACT, SEND_SMS, SEND_WHATSAPP, SEND_EMAIL
- অ্যাপ/ফাইল: OPEN_APP, UNINSTALL_APP, SEARCH_FILES, DELETE_FILE
- এআই: SEARCH_GOOGLE, GENERATE_IMAGE, WEATHER_INFO

নিরাপত্তা সতর্কতা: কোনো অবৈধ বা ক্ষতিকর কমান্ড পালন করবে না।
`;

const App: React.FC = () => {
  const [isActive, setIsActive] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);
  const [isProcessingAI, setIsProcessingAI] = useState(false);
  const [generatedContent, setGeneratedContent] = useState<{ type: 'image' | 'video', url: string } | null>(null);
  const [selectedSize, setSelectedSize] = useState<ImageSize>('1K');
  const [selectedRatio, setSelectedRatio] = useState<AspectRatio>('16:9');
  
  // State for pending actions requiring confirmation
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
  const [userTranscription, setUserTranscription] = useState('');

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

  const handleAction = useCallback((actionStr: string) => {
    const action = actionStr.replace('[ACTION: ', '').replace(']', '').trim();
    
    // Check if this action requires a confirmation modal
    if (action === 'CALL_CONTACT' || action === 'SEND_SMS' || action === 'DELETE_FILE') {
      setPendingAction({ type: action });
      return;
    }

    let notificationText = "";
    setSystem(prev => {
      const next = { ...prev };
      switch (action) {
        case 'WIFI_ON': next.wifi = true; notificationText = "WiFi চালু হয়েছে"; break;
        case 'WIFI_OFF': next.wifi = false; notificationText = "WiFi বন্ধ হয়েছে"; break;
        case 'BLUETOOTH_ON': next.bluetooth = true; notificationText = "Bluetooth চালু হয়েছে"; break;
        case 'BLUETOOTH_OFF': next.bluetooth = false; notificationText = "Bluetooth বন্ধ হয়েছে"; break;
        case 'FLASHLIGHT_ON': next.flashlight = true; notificationText = "ফ্ল্যাশলাইট অন হয়েছে"; break;
        case 'FLASHLIGHT_OFF': next.flashlight = false; notificationText = "ফ্ল্যাশলাইট অফ হয়েছে"; break;
        case 'AIRPLANE_ON': next.airplaneMode = true; notificationText = "এয়ারপ্লেন মোড অন"; break;
        case 'AIRPLANE_OFF': next.airplaneMode = false; notificationText = "এয়ারপ্লেন মোড অফ"; break;
        case 'VOLUME_UP': next.volume = Math.min(100, prev.volume + 15); notificationText = "ভলিউম বাড়ানো হয়েছে"; break;
        case 'VOLUME_DOWN': next.volume = Math.max(0, prev.volume - 15); notificationText = "ভলিউম কমানো হয়েছে"; break;
        case 'MUTE': next.isMuted = true; notificationText = "ডিভাইস মিউট করা হয়েছে"; break;
        case 'UNMUTE': next.isMuted = false; notificationText = "মিউট সরানো হয়েছে"; break;
        case 'LOCK': next.screenLocked = true; notificationText = "স্ক্রিন লক করা হয়েছে"; break;
        case 'UNLOCK': next.screenLocked = false; notificationText = "স্ক্রিন আনলক হয়েছে"; break;
      }
      return next;
    });
    if (notificationText) showNotification(notificationText);
    setActionLogs(prev => [{ id: Date.now().toString(), action, timestamp: Date.now() }, ...prev.slice(0, 14)]);
  }, []);

  const confirmAction = () => {
    if (!pendingAction) return;
    const action = pendingAction.type;
    let notificationText = "";
    
    switch (action) {
      case 'CALL_CONTACT': notificationText = "কল দেওয়া হচ্ছে..."; break;
      case 'SEND_SMS': notificationText = "মেসেজ পাঠানো হয়েছে"; break;
      case 'DELETE_FILE': notificationText = "ফাইল মুছে ফেলা হয়েছে"; break;
    }

    showNotification(notificationText);
    setActionLogs(prev => [{ id: Date.now().toString(), action: `${action}_CONFIRMED`, timestamp: Date.now() }, ...prev.slice(0, 14)]);
    setPendingAction(null);
  };

  const cancelAction = () => {
    if (pendingAction) {
      showNotification("অ্যাকশন বাতিল করা হয়েছে");
      setActionLogs(prev => [{ id: Date.now().toString(), action: `${pendingAction.type}_CANCELLED`, timestamp: Date.now() }, ...prev.slice(0, 14)]);
    }
    setPendingAction(null);
  };

  const processOutputTranscription = useCallback((text: string) => {
    const actionMatch = text.match(/\[ACTION: [A-Z_]+\]/g);
    if (actionMatch) {
      actionMatch.forEach(handleAction);
    }
  }, [handleAction]);

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
    } catch (err) {
      console.error("TTS Error:", err);
    }
  };

  const fastAIReponse = async (promptText: string) => {
    setIsProcessingAI(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-flash-lite-latest',
        contents: promptText,
        config: { systemInstruction: "Answer briefly in Bengali. Address the user as Mira." }
      });
      const text = response.text || "দুঃখিত, আমি বুঝতে পারিনি।";
      setMessages(prev => [...prev, { role: 'user', text: promptText, timestamp: Date.now() }, { role: 'assistant', text, timestamp: Date.now() }]);
      generateSpeech(text);
    } catch (err) {
      showNotification("AI Error occurred");
    } finally {
      setIsProcessingAI(false);
    }
  };

  const complexReasoning = async (promptText: string) => {
    setIsProcessingAI(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: "gemini-3-pro-preview",
        contents: promptText,
        config: { 
          thinkingConfig: { thinkingBudget: 32768 },
          systemInstruction: "You are a deep thinker. Solve complex Android problems in Bengali. Address the user as Mira."
        },
      });
      const text = response.text || "";
      setMessages(prev => [...prev, { role: 'user', text: promptText, timestamp: Date.now() }, { role: 'assistant', text, timestamp: Date.now(), isThinking: true }]);
      generateSpeech(text);
    } catch (err) {
      showNotification("Reasoning Error");
    } finally {
      setIsProcessingAI(false);
    }
  };

  const transcribeAudioViaFlash = async () => {
    setIsProcessingAI(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: "Transcribe the following audio accurately.",
        config: { systemInstruction: "Provide a verbatim transcription of user input in Bengali." }
      });
      showNotification("Transcribing...");
      setMessages(prev => [...prev, { role: 'assistant', text: `Transcription: ${response.text}`, timestamp: Date.now() }]);
    } catch (err) {
      showNotification("Transcription failed");
    } finally {
      setIsProcessingAI(false);
    }
  };

  const handleGenerateImage = async () => {
    const description = window.prompt("Enter image description (Bengali or English):") || "A futuristic android robot in a green jungle";
    if (!(await (window as any).aistudio.hasSelectedApiKey())) {
      await (window as any).aistudio.openSelectKey();
    }
    setIsProcessingAI(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-image-preview',
        contents: { parts: [{ text: description }] },
        config: { imageConfig: { aspectRatio: "1:1", imageSize: selectedSize } },
      });
      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          const url = `data:image/png;base64,${part.inlineData.data}`;
          setGeneratedContent({ type: 'image', url });
          showNotification(`Image (${selectedSize}) generated!`);
        }
      }
    } catch (err) {
      showNotification("Image generation failed");
    } finally {
      setIsProcessingAI(false);
    }
  };

  const handleGenerateVideo = async () => {
    const videoPromptInput = window.prompt("Enter video prompt:") || "A floating drone scanning a futuristic Dhaka city";
    if (!(await (window as any).aistudio.hasSelectedApiKey())) {
      await (window as any).aistudio.openSelectKey();
    }
    setIsProcessingAI(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      let operation = await ai.models.generateVideos({
        model: 'veo-3.1-fast-generate-preview',
        prompt: videoPromptInput,
        config: { numberOfVideos: 1, resolution: '720p', aspectRatio: selectedRatio }
      });
      while (!operation.done) {
        await new Promise(resolve => setTimeout(resolve, 10000));
        operation = await ai.operations.getVideosOperation({ operation: operation });
      }
      const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
      const response = await fetch(`${downloadLink}&key=${process.env.API_KEY}`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      setGeneratedContent({ type: 'video', url });
      showNotification("Video generation complete!");
    } catch (err) {
      showNotification("Video failed. Check permissions.");
    } finally {
      setIsProcessingAI(false);
    }
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
          inputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            setIsActive(true); setIsConnecting(false);
            const source = inputAudioContextRef.current!.createMediaStreamSource(stream);
            const scriptProcessor = inputAudioContextRef.current!.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createPcmBlob(inputData);
              sessionPromise.then(session => session.sendRealtimeInput({ media: pcmBlob }));
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputAudioContextRef.current!.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.outputTranscription) {
              currentOutputTextRef.current += message.serverContent.outputTranscription.text;
              setCurrentTranscription(currentOutputTextRef.current);
            } else if (message.serverContent?.inputTranscription) {
              currentInputTextRef.current += message.serverContent.inputTranscription.text;
              setUserTranscription(currentInputTextRef.current);
            }
            if (message.serverContent?.turnComplete) {
              const userMsg = currentInputTextRef.current;
              const assistantMsg = currentOutputTextRef.current;
              if (userMsg || assistantMsg) {
                setMessages(prev => [...prev, { role: 'user', text: userMsg, timestamp: Date.now() }, { role: 'assistant', text: assistantMsg, timestamp: Date.now() }]);
              }
              processOutputTranscription(assistantMsg);
              currentInputTextRef.current = ''; currentOutputTextRef.current = '';
              setCurrentTranscription(''); setUserTranscription('');
            }
            const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64Audio && outputAudioContextRef.current) {
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outputAudioContextRef.current.currentTime);
              const audioBuffer = await decodeAudioData(decode(base64Audio), outputAudioContextRef.current, 24000, 1);
              const source = outputAudioContextRef.current.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(outputAudioContextRef.current.destination);
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              audioSourcesRef.current.add(source);
            }
          },
          onerror: () => { setIsActive(false); setIsConnecting(false); },
          onclose: () => { setIsActive(false); setIsConnecting(false); }
        }
      });
    } catch (err) { setIsConnecting(false); }
  };

  const stopAudio = useCallback(() => {
    audioSourcesRef.current.forEach(source => { try { source.stop(); } catch (e) {} });
    audioSourcesRef.current.clear();
    nextStartTimeRef.current = 0;
  }, []);

  const stopSession = () => {
    setIsActive(false); stopAudio();
    if (inputAudioContextRef.current) inputAudioContextRef.current.close();
    if (outputAudioContextRef.current) outputAudioContextRef.current.close();
  };

  return (
    <div className={`min-h-screen p-4 md:p-8 flex flex-col items-center justify-center relative transition-all duration-700 ${system.flashlight ? 'bg-[#1a1a1a]' : 'bg-[#050505]'}`}>
      <div className="absolute top-0 left-0 w-full h-full pointer-events-none overflow-hidden opacity-20">
        <div className={`absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full blur-[140px] transition-all duration-1000 ${isActive || isProcessingAI ? 'bg-blue-600' : 'bg-indigo-900'}`} />
        <div className={`absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full blur-[140px] transition-all duration-1000 ${isActive || isProcessingAI ? 'bg-purple-600' : 'bg-blue-900'}`} />
      </div>

      {notification && (
        <div className="fixed top-10 left-1/2 -translate-x-1/2 z-[100] bg-blue-600 text-white px-6 py-3 rounded-full shadow-xl shadow-blue-500/20 font-medium animate-bounce border border-white/20">
          {notification}
        </div>
      )}

      {/* Confirmation Dialog Overlay */}
      {pendingAction && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="glass w-[90%] max-w-sm rounded-[2.5rem] p-8 space-y-6 border border-white/10 shadow-2xl scale-in-center">
            <div className="flex justify-center">
              <div className="w-16 h-16 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-400">
                {pendingAction.type === 'CALL_CONTACT' ? <Phone size={32} /> : pendingAction.type === 'SEND_SMS' ? <Mail size={32} /> : <Trash2 className="text-red-400" size={32} />}
              </div>
            </div>
            <div className="text-center space-y-2">
              <h3 className="text-xl font-bold text-white">নিশ্চিত করুন</h3>
              <p className="text-gray-400 text-sm">
                {pendingAction.type === 'CALL_CONTACT' ? "মিরা, আপনি কি কল করতে চান?" : 
                 pendingAction.type === 'SEND_SMS' ? "মিরা, আপনি কি মেসেজ পাঠাতে চান?" : 
                 "মিরা, আপনি কি এই ফাইলটি মুছে ফেলতে চান?"}
              </p>
            </div>
            <div className="flex gap-4">
              <button 
                onClick={cancelAction}
                className="flex-1 py-4 bg-white/5 rounded-2xl text-gray-400 hover:bg-white/10 flex items-center justify-center gap-2 font-bold transition-all"
              >
                <X size={18} /> বাতিল
              </button>
              <button 
                onClick={confirmAction}
                className={`flex-1 py-4 rounded-2xl text-white flex items-center justify-center gap-2 font-bold transition-all shadow-lg ${pendingAction.type === 'DELETE_FILE' ? 'bg-red-600 shadow-red-500/20' : 'bg-blue-600 shadow-blue-500/20'}`}
              >
                <Check size={18} /> নিশ্চিত
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-7xl w-full grid grid-cols-1 lg:grid-cols-12 gap-8 relative z-10">
        <div className="lg:col-span-3 space-y-6">
          <div className="glass rounded-[2rem] p-6 space-y-6">
            <h2 className="text-sm font-bold text-blue-400 uppercase tracking-widest flex items-center gap-2">
              <ShieldCheck size={16} /> Device Health
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <div className={`p-3 rounded-xl border flex items-center justify-center transition-all ${system.wifi ? 'bg-blue-500/20 border-blue-500/30 text-blue-400' : 'bg-white/5 border-white/5 text-gray-600'}`}>
                {system.wifi ? <Wifi size={16}/> : <WifiOff size={16}/>}
              </div>
              <div className={`p-3 rounded-xl border flex items-center justify-center transition-all ${system.bluetooth ? 'bg-blue-500/20 border-blue-500/30 text-blue-400' : 'bg-white/5 border-white/5 text-gray-600'}`}>
                <Bluetooth size={16}/>
              </div>
              <div className={`p-3 rounded-xl border flex items-center justify-center transition-all ${system.airplaneMode ? 'bg-blue-500/20 border-blue-500/30 text-blue-400' : 'bg-white/5 border-white/5 text-gray-600'}`}>
                <Plane size={16}/>
              </div>
              <div className={`p-3 rounded-xl border flex items-center justify-center transition-all ${system.flashlight ? 'bg-yellow-500/20 border-yellow-500/30 text-yellow-400' : 'bg-white/5 border-white/5 text-gray-600'}`}>
                <FlashlightIcon size={16}/>
              </div>
            </div>
            <div className="space-y-4 pt-4 border-t border-white/10">
              <div className="flex items-center gap-3">
                <Battery size={16} className="text-green-500" />
                <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                  <div className="h-full bg-green-500" style={{ width: `${system.battery}%` }} />
                </div>
                <span className="text-[10px] font-mono text-gray-400">{system.battery}%</span>
              </div>
              <div className="flex items-center gap-3">
                <Sun size={16} className="text-yellow-500" />
                <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                  <div className="h-full bg-yellow-500" style={{ width: `${system.brightness}%` }} />
                </div>
                <span className="text-[10px] font-mono text-gray-400">{system.brightness}%</span>
              </div>
            </div>
          </div>

          <div className="glass rounded-[2rem] p-6 space-y-6">
            <h2 className="text-sm font-bold text-purple-400 uppercase tracking-widest flex items-center gap-2">
              <Brain size={16} /> Gemini Lab
            </h2>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Image Quality (Nano Banana Pro)</label>
                <div className="flex gap-2">
                  {(['1K', '2K', '4K'] as ImageSize[]).map(s => (
                    <button key={s} onClick={() => setSelectedSize(s)} className={`flex-1 py-2 text-[10px] rounded-lg border transition-all ${selectedSize === s ? 'bg-purple-600 border-purple-400 text-white' : 'bg-white/5 border-white/5 text-gray-500 hover:bg-white/10'}`}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Video Ratio (Veo)</label>
                <div className="flex gap-2">
                  {(['16:9', '9:16'] as AspectRatio[]).map(r => (
                    <button key={r} onClick={() => setSelectedRatio(r)} className={`flex-1 py-2 text-[10px] rounded-lg border transition-all ${selectedRatio === r ? 'bg-indigo-600 border-indigo-400 text-white' : 'bg-white/5 border-white/5 text-gray-500 hover:bg-white/10'}`}>
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              <button 
                onClick={transcribeAudioViaFlash}
                disabled={isProcessingAI}
                className="w-full py-3 bg-white/5 rounded-xl text-xs font-bold hover:bg-blue-600/20 flex items-center justify-center gap-2 transition-colors border border-white/5"
              >
                <TypeIcon size={14} className="text-blue-400" /> Transcribe Input
              </button>
            </div>
          </div>
        </div>

        <div className="lg:col-span-6 flex flex-col items-center justify-between py-6">
          <div className="text-center">
            <h1 className="text-5xl font-black tracking-tighter bg-gradient-to-r from-blue-400 via-indigo-400 to-purple-400 bg-clip-text text-transparent italic">
              ANDROID AI
            </h1>
            <p className="text-gray-500 text-[10px] font-mono mt-1 tracking-[0.4em] uppercase">Multi-Engine v3.0</p>
          </div>

          <div className="relative group cursor-pointer mt-12 mb-12" onClick={isActive ? stopSession : startSession}>
            <div className={`absolute inset-[-60px] rounded-full blur-[80px] transition-all duration-1000 ${isActive || isProcessingAI ? 'bg-blue-500/20 scale-125' : 'bg-transparent scale-90'}`} />
            <div className="relative z-10 w-52 h-52 rounded-full flex items-center justify-center transition-all duration-500 active:scale-95">
              {isActive && (
                <>
                  <div className="absolute inset-0 rounded-full border-2 border-blue-500/20 animate-ping" />
                  <div className="absolute inset-[-10px] rounded-full bg-blue-500/5 pulse-animation" />
                </>
              )}
              <div className={`w-36 h-36 rounded-full flex items-center justify-center shadow-2xl transition-all duration-500 ${isActive ? 'bg-blue-600 shadow-blue-500/50 scale-110' : 'bg-white/5 border border-white/10'}`}>
                {isProcessingAI ? <Loader2 size={64} className="text-white animate-spin" /> : 
                 isActive ? <Mic size={72} className="text-white" /> : <MicOff size={72} className="text-gray-700" />}
              </div>
            </div>
          </div>

          <div className="w-full min-h-[300px] overflow-hidden">
            {generatedContent ? (
              <div className="glass rounded-[2.5rem] p-4 relative animate-in zoom-in duration-500 border border-white/10 shadow-2xl">
                <button onClick={() => setGeneratedContent(null)} className="absolute -top-4 -right-4 w-10 h-10 bg-red-500 text-white rounded-full flex items-center justify-center shadow-lg font-bold z-50">×</button>
                {generatedContent.type === 'image' ? (
                  <img src={generatedContent.url} className="w-full rounded-2xl" alt="AI Generated" />
                ) : (
                  <video src={generatedContent.url} controls autoPlay className="w-full rounded-2xl shadow-inner" />
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-6">
                 {isActive ? (
                  <div className="text-center space-y-4 px-12">
                    <p className="text-blue-400 text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2">
                      <Zap size={12} className="animate-bounce"/> Neural Link Active
                    </p>
                    <p className="text-white text-2xl font-bold leading-tight drop-shadow-md italic">
                      {currentTranscription || "আপনার কথা বলুন, মিরা..."}
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-4 w-full px-6">
                    <ActionButton icon={<ImageIcon size={20}/>} label="Gen Image" onClick={handleGenerateImage} color="purple" />
                    <ActionButton icon={<Video size={20}/>} label="Gen Video" onClick={handleGenerateVideo} color="indigo" />
                    <ActionButton icon={<Brain size={20}/>} label="Pro Think" onClick={() => complexReasoning("How can I fully optimize Android storage manually?")} color="blue" />
                    <ActionButton icon={<Zap size={20}/>} label="Fast Chat" onClick={() => fastAIReponse("Today's trending news in Bengali")} color="yellow" />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-3 space-y-6 flex flex-col">
          <div className="glass rounded-[2rem] p-6 flex-1 flex flex-col overflow-hidden min-h-[350px]">
            <h2 className="text-xs font-bold text-indigo-400 uppercase tracking-widest flex items-center gap-2 mb-6">
              <MessageSquare size={14} /> Neural Feed
            </h2>
            <div className="flex-1 overflow-y-auto space-y-5 pr-2 scrollbar-thin scrollbar-thumb-white/10">
              {messages.length === 0 ? (
                <div className="h-full flex items-center justify-center px-6 text-center">
                  <p className="text-gray-700 text-xs italic leading-relaxed">মিরা, আপনার কথাবার্তা এখানে প্রদর্শিত হবে। এআই ল্যাবের সুবিধাগুলো পরীক্ষা করে দেখুন।</p>
                </div>
              ) : (
                messages.map((msg, idx) => (
                  <div key={idx} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                    <div className={`p-4 rounded-2xl text-[12px] leading-relaxed max-w-[90%] shadow-sm ${
                      msg.role === 'user' ? 'bg-blue-600/10 text-blue-100 border border-blue-500/10' : 'bg-white/5 text-gray-300 border border-white/5'
                    }`}>
                      {msg.isThinking && <div className="text-[9px] text-purple-400 mb-2 font-black uppercase tracking-tighter flex items-center gap-1">
                        <Brain size={10}/> Intelligent Reasoning
                      </div>}
                      {msg.text}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
          
          <div className="glass rounded-[2rem] p-6 max-h-[180px] overflow-hidden">
             <h2 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-4 flex items-center gap-2">
               <Activity size={12}/> System Logs
             </h2>
             <div className="space-y-2 overflow-y-auto h-full scrollbar-none">
               {actionLogs.map(log => (
                 <div key={log.id} className="text-[9px] font-mono text-gray-600 border-l border-blue-500/20 pl-2 animate-in slide-in-from-left duration-300">
                   [{new Date(log.timestamp).toLocaleTimeString([], { hour12: false })}] {log.action}
                 </div>
               ))}
             </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const ActionButton = ({ icon, label, onClick, color }: any) => {
  const colors: any = {
    purple: 'hover:border-purple-500/50 text-purple-400',
    indigo: 'hover:border-indigo-500/50 text-indigo-400',
    blue: 'hover:border-blue-500/50 text-blue-400',
    yellow: 'hover:border-yellow-500/50 text-yellow-400'
  };
  return (
    <button onClick={onClick} className={`flex flex-col items-center justify-center gap-3 p-8 bg-white/5 rounded-[2.5rem] border border-white/5 hover:bg-white/10 transition-all group ${colors[color]}`}>
      <div className="transition-transform group-hover:scale-125 duration-300">{icon}</div>
      <span className="text-[10px] font-black text-gray-500 group-hover:text-gray-200 uppercase tracking-tight">{label}</span>
    </button>
  );
};

export default App;
