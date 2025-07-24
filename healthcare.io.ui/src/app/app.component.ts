import { ChatbotService } from './service/chatbot.service';
import { KvsService } from './service/kvs.service';
import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { Role } from './kvsRole';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ChatMessage } from './chatMessage';
import { AudioService } from './service/audio.service';
import { TranscribeService } from './service/transcribe.service';
import { TranslateService } from './service/translate.service';
import { Language } from '@aws-sdk/client-translate';



/**
 * 健康照護視訊通話主元件
 * 提供 WebRTC 視訊通話、語音轉錄、聊天機器人等功能
 */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [DatePipe, FormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  /** 遠端視訊元素參考 */
  @ViewChild("remoteView", { static: true }) remoteView: ElementRef = new ElementRef(null);
  /** 本地視訊元素參考 */
  @ViewChild("localView", { static: true }) localView: ElementRef = new ElementRef(null);

  /** 本地媒體串流 */
  localStream!: MediaStream;
  /** 遠端媒體串流 */
  remoteStream!: MediaStream;

  /** 語音轉錄文字 */
  transcriptionText = '';
  /** 是否正在錄音 */
  isRecording: boolean = false;

  /** 應用程式模式：初始化、主控端、觀看端 */
  mode: 'init' | 'master' | 'viewer' = 'init';
  /** 聊天會話 ID */
  sessionId = '';
  /** 聊天室是否開啟 */
  isChatOpen = false;
  /** 目前輸入的訊息 */
  currentMessage = '';
  /** 聊天訊息列表 */
  chatMessages: ChatMessage[] = [];
  /** 是否正在載入訊息 */
  isLoadingMessage = false;

  /** 語言選擇器是否開啟 */
  isLanguageOpen = false;

  // 當前選擇的語言
  selectedTranscribeLanguage: string = 'zh-TW';  // 預設中文轉錄
  selectedTranslateLanguage: string = 'zh-TW';   // 預設翻譯成中文

  /** 可用的轉錄語言列表 */
  translateLanguages: Language[] = []


  /** Toast 通知相關 */
  toastMessage = '';
  isToastVisible = false;

  // 轉錄語言選項（支援的語音識別語言）
  transcribeLanguages = [
    { LanguageCode: 'zh-TW', LanguageName: '繁體中文' },
    { LanguageCode: 'zh-CN', LanguageName: '簡體中文' },
    { LanguageCode: 'en-US', LanguageName: '英文（美國）' },
    { LanguageCode: 'en-GB', LanguageName: '英文（英國）' },
    { LanguageCode: 'ja-JP', LanguageName: '日文' },
    { LanguageCode: 'ko-KR', LanguageName: '韓文' },
  ];

  /**
   * 建構函式
   * 初始化各種服務並訂閱事件
   */
  constructor(
    private transcribeService: TranscribeService,
    private kvsService: KvsService,
    private audioService: AudioService,
    private chatbotService: ChatbotService,
    private translateService: TranslateService) {

    this.sessionId = this.generateSessionId();

    // 訂閱轉錄文字更新
    this.transcribeService.transcribeText.subscribe(text => {
      this.transcriptionText = text;
    });

    // 訂閱錄音狀態更新
    this.audioService.isRecording.subscribe(bool => {
      this.isRecording = bool;
    });

    // 訂閱語言代碼更新
    this.translateService.languageCodes.subscribe(languages => {
      this.translateLanguages = languages;
    });
  }

  /**
   * 產生唯一的會話 ID
   * @returns {string} 格式為 'session_時間戳_隨機字串' 的會話 ID
   */
  private generateSessionId(): string {
    return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  /**
   * 觀看端點擊開始連線
   * 建立 WebRTC 連線作為觀看端，並啟動語音轉錄
   * @returns {Promise<void>}
   */
  async onclickViewer() {
    this.mode = 'viewer';

    const clientId = Math.floor(Math.random() * 999999).toString();

    const endpoints = await this.kvsService.getSignalingChannelEndpoint(Role.VIEWER);
    const httpsEndpoint = endpoints.ResourceEndpointList?.find(x => x.Protocol === 'HTTPS')?.ResourceEndpoint ?? '';
    const wssEndpoint = endpoints.ResourceEndpointList?.find(x => x.Protocol === 'WSS')?.ResourceEndpoint ?? '';
    const iceServers = await this.kvsService.getIceServers(httpsEndpoint);
    const peerConnection = new RTCPeerConnection({ iceServers });
    const signalingClient = await this.kvsService.createSignalingClient(wssEndpoint, Role.VIEWER, clientId);

    this.setupConnectionStateHandler(peerConnection);
    signalingClient.on('open', async () => {
      const viewerStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      });

      this.localView.nativeElement.srcObject = viewerStream;
      this.localStream = viewerStream;

      viewerStream.getTracks().forEach(track => peerConnection.addTrack(track, viewerStream));
      await peerConnection.setLocalDescription(await peerConnection.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true }));
      signalingClient.sendSdpOffer(peerConnection.localDescription as RTCSessionDescription);
    });
    signalingClient.on('sdpAnswer', async answer => {
      await peerConnection.setRemoteDescription(answer);
      // RTC 連線完成後自動啟動轉錄
      console.log('Viewer: RTC 連線完成，啟動轉錄系統');
      await this.transcribeService.startTranscription(this.localStream, this.remoteStream);
    });
    signalingClient.on('iceCandidate', candidate => {
      peerConnection.addIceCandidate(candidate);
    });
    signalingClient.on('close', () => {
      console.log('Signaling client closed');
    });
    signalingClient.on('error', error => { console.log('error', error); });
    peerConnection.addEventListener('icecandidate', ({ candidate }) => {
      if (candidate) signalingClient.sendIceCandidate(candidate);
    });
    peerConnection.addEventListener('track', event => {
      this.remoteView.nativeElement.srcObject = event.streams[0];
      this.remoteStream = event.streams[0];
      this.transcribeService.updateTranscribeStream(this.localStream, this.remoteStream);
    });

    signalingClient.open();
  }

  /**
   * 主控端點擊開始連線
   * 建立 WebRTC 連線作為主控端，並啟動語音轉錄
   * @returns {Promise<void>}
   */
  async onclickMaster() {
    this.mode = 'master';

    let remoteId = '';
    const endpoints = await this.kvsService.getSignalingChannelEndpoint(Role.MASTER);
    const httpsEndpoint = endpoints.ResourceEndpointList?.find(x => x.Protocol === 'HTTPS')?.ResourceEndpoint ?? '';
    const wssEndpoint = endpoints.ResourceEndpointList?.find(x => x.Protocol === 'WSS')?.ResourceEndpoint ?? '';
    const iceServers = await this.kvsService.getIceServers(httpsEndpoint);
    const peerConnection = new RTCPeerConnection({ iceServers, iceTransportPolicy: 'all' });
    const signalingClient = await this.kvsService.createSignalingClient(wssEndpoint, Role.MASTER);

    this.setupConnectionStateHandler(peerConnection);

    signalingClient.on('open', async () => {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      });
      this.localView.nativeElement.srcObject = this.localStream;
      this.localStream.getTracks().forEach(track => peerConnection.addTrack(track, this.localStream));
    });
    signalingClient.on('sdpOffer', async (offer, remoteClientId) => {
      remoteId = remoteClientId;
      await peerConnection.setRemoteDescription(offer);
      await peerConnection.setLocalDescription(await peerConnection.createAnswer({ offerToReceiveAudio: true, offerToReceiveVideo: true }));
      signalingClient.sendSdpAnswer(peerConnection.localDescription as RTCSessionDescription, remoteId);
      // RTC 連線完成後自動啟動轉錄
      console.log('Master: RTC 連線完成，啟動轉錄系統');
      await this.transcribeService.startTranscription(this.localStream, this.remoteStream);
    });
    signalingClient.on('iceCandidate', candidate => {
      peerConnection.addIceCandidate(candidate);
    });
    signalingClient.on('close', () => {
      console.log('Signaling client closed');
    });
    signalingClient.on('error', error => { console.log('error', error); });
    peerConnection.addEventListener('icecandidate', ({ candidate }) => {
      if (candidate) signalingClient.sendIceCandidate(candidate, remoteId);
    });
    peerConnection.addEventListener('track', event => {
      this.remoteView.nativeElement.srcObject = event.streams[0];
      this.remoteStream = event.streams[0];
      this.transcribeService.updateTranscribeStream(this.localStream, this.remoteStream);
    });


    signalingClient.open();
  }


  /**
   * 處理 RTC 連線狀態變化
   * @param peerConnection RTCPeerConnection 實例
   */
  private setupConnectionStateHandler(peerConnection: RTCPeerConnection) {
    peerConnection.onconnectionstatechange = () => {
      switch (peerConnection.connectionState) {
        case 'connected':
          console.log('RTC 連線已建立');
          break;
        case 'disconnected':
          console.log('RTC 連線中斷');
          this.transcribeService.stopTranscribing();
          this.showToast('RTC 連線中斷，請重新連線', 5000);
          break;
        case 'failed':
          console.log('RTC 連線失敗');
          this.transcribeService.stopTranscribing();
          this.showToast('RTC 連線失敗，請重新連線', 5000);
          break;
        case 'closed':
          console.log('RTC 連線已關閉');
          this.transcribeService.stopTranscribing();
          this.showToast('RTC 連線已關閉，請重新連線', 5000);
          break;
      }
    };
  }
  /**
   * 開始錄音
   * 使用音訊服務開始錄製本地和遠端音訊
   * @returns {Promise<void>}
   */
  async startRecording() {
    await this.audioService.startRecording(this.localStream, this.remoteStream);
  }

  /**
   * 停止錄音
   * 停止音訊錄製並處理錄音結果
   * @returns {Promise<void>}
   */
  async stopRecording() {
    await this.audioService.stopRecording();
  }

  /**
   * 發送聊天訊息
   * 將使用者訊息發送至聊天機器人並接收回應
   * @returns {Promise<void>}
   */
  async sendMessage() {
    if (!this.currentMessage.trim() || this.isLoadingMessage) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      text: this.currentMessage,
      isUser: true,
      timestamp: new Date()
    };

    this.chatMessages.push(userMessage);
    const messageToSend = this.currentMessage;
    this.currentMessage = '';
    this.isLoadingMessage = true;

    try {

      const response = await this.chatbotService.SendMessage(messageToSend, this.sessionId);
      const aiMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        text: response || '抱歉，我暫時無法回應。',
        isUser: false,
        timestamp: new Date()
      };

      this.chatMessages.push(aiMessage);
    } catch (error) {
      console.error('發送訊息失敗:', error);
      const errorMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        text: '抱歉，發送訊息時發生錯誤，請稍後再試。',
        isUser: false,
        timestamp: new Date()
      };
      this.chatMessages.push(errorMessage);
    } finally {
      this.isLoadingMessage = false;
      setTimeout(() => this.scrollToBottom(), 100);
    }
  }

  /**
   * 處理鍵盤按鍵事件
   * 當按下 Enter 鍵時發送訊息
   * @param {KeyboardEvent} event - 鍵盤事件
   */
  onKeyPress(event: KeyboardEvent) {
    if (event.isComposing || event.keyCode === 229) {
      return;
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
      this.scrollToBottom();
    }
  }

  /**
   * 滾動聊天室到底部
   * 確保最新訊息可見
   * @private
   */
  private scrollToBottom() {
    const chatContainer = document.querySelector('.chat-messages');
    if (chatContainer) {
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }
  }

  /**
   * 清除聊天記錄
   * 清空所有聊天訊息並重新產生會話 ID
   */
  clearChat() {
    this.chatMessages = [];
    this.sessionId = this.generateSessionId();
  }

  /**
   * 選擇轉錄語言
   * @param languageCode
   */
  selectTranscribeLanguage(languageCode: string) {
    this.selectedTranscribeLanguage = languageCode;
    console.log('轉錄語言設定為:', languageCode);
    this.transcribeService.setTranscribeLanguage(languageCode);
    this.translateService.setTranscribeLanguage(languageCode);
  }

  /**
   * 選擇翻譯語言
   * @param languageCode
   */
  selectTranslateLanguage(languageCode: string) {
    this.selectedTranslateLanguage = languageCode;
    console.log('翻譯語言設定為:', languageCode);
    this.translateService.setTranslateLanguage(languageCode);
  }

  /**
  * 顯示 Toast 通知
  * @param message 要顯示的訊息
  * @param duration 顯示持續時間（毫秒）
  */
  showToast(message: string, duration: number = 5000) {
    this.toastMessage = message;
    this.isToastVisible = true;

    setTimeout(() => {
      this.isToastVisible = false;
    }, duration);
  }
}
