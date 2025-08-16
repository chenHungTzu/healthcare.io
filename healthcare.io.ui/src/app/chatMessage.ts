export interface ChatMessage {
  id: string;
  text: string;
  isUser: boolean;
  timestamp: Date;
  role?: 'patient' | 'doctor';
  isMe : boolean;
}
