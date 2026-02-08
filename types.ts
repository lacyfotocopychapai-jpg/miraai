
export interface SystemState {
  wifi: boolean;
  bluetooth: boolean;
  flashlight: boolean;
  airplaneMode: boolean;
  mobileData: boolean;
  brightness: number;
  volume: number;
  isMuted: boolean;
  battery: number;
  screenLocked: boolean;
}

export interface Message {
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
  audioUrl?: string;
  isThinking?: boolean;
}

export interface ActionLog {
  id: string;
  action: string;
  timestamp: number;
}

export type ImageSize = '1K' | '2K' | '4K';
export type AspectRatio = '16:9' | '9:16';
