import { Component, ElementRef, ViewChild } from '@angular/core';
import { environment } from '../environments/environment';
import { CognitoIdentityClient, GetIdCommand, GetOpenIdTokenCommand } from '@aws-sdk/client-cognito-identity';
import { STSClient, AssumeRoleWithWebIdentityCommand } from '@aws-sdk/client-sts';
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { KinesisVideoClient, GetSignalingChannelEndpointCommand } from '@aws-sdk/client-kinesis-video';
import { KinesisVideoSignalingClient, GetIceServerConfigCommand } from '@aws-sdk/client-kinesis-video-signaling';
import { TranscribeStreamingClient, StartStreamTranscriptionCommand, AudioStream } from '@aws-sdk/client-transcribe-streaming';
import { Role } from './kvsRole';
import { AwsConfig } from './aws.config';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ChatMessage } from './chatMessage';

const KVSWebRTC = (window as any).KVSWebRTC;

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [DatePipe, FormsModule, HttpClientModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  @ViewChild("remoteView", { static: true }) remoteView: ElementRef = new ElementRef(null);
  @ViewChild("localView", { static: true }) localView: ElementRef = new ElementRef(null);

  localStream!: MediaStream;
  remoteStream!: MediaStream;
  mediaRecorder!: MediaRecorder;
  recordedChunks: Blob[] = [];

  // 新增即時轉錄相關屬性
  audioContext!: AudioContext;
  analyser!: AnalyserNode;
  transcribeClient!: TranscribeStreamingClient;
  isTranscribing = false;
  transcriptionText = '';
  soundDetectionActive = false;
  isTranscribeStreamActive = false;
  currentTranscribeCommand: any = null;
  transcribeMediaRecorder!: MediaRecorder; // 替換 audioProcessor
  transcribeStream!: MediaStream; // 用於轉錄的音訊流

  mode: 'init' | 'master' | 'viewer' = 'init';
  isRecording = false;
  isUploading = false;
  sessionId = '';
  isChatOpen = false;
  currentMessage = '';
  chatMessages: ChatMessage[] = [];
  isLoadingMessage = false;

  constructor(private http: HttpClient) {
    // 初始化 sessionId
    this.sessionId = this.generateSessionId();

    // 一開始就初始化 Transcribe Client
    this.initTranscribeClient();
  }

  private generateSessionId(): string {
    return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  /**
   * 取得 AWS 設定（動態取得臨時憑證）
   * @returns
   */
  private async getAwsConfig(): Promise<AwsConfig> {
    // 1. 產生臨時ID (未授權身份)
    const cognitoIdentity = new CognitoIdentityClient({ region: environment.region });
    const identityPoolId = environment.identity_pool_id;
    const getIdRes = await cognitoIdentity.send(new GetIdCommand({ IdentityPoolId: identityPoolId }));
    const identityId = getIdRes.IdentityId!;
    console.log('IdentityId:', identityId);
    // 2. 取得 token
    const getTokenRes = await cognitoIdentity.send(new GetOpenIdTokenCommand({ IdentityId: identityId }));
    const openIdToken = getTokenRes.Token!;
    console.log('OpenIdToken:', openIdToken);
    // 3. 取得臨時憑證
    const sts = new STSClient({ region: environment.region });
    const roleSessionName = Math.floor(Math.random() * 100000).toString().padStart(5, '0');
    const assumeRoleRes = await sts.send(new AssumeRoleWithWebIdentityCommand({
      RoleArn: environment.kvs_role_arn,
      RoleSessionName: roleSessionName,
      WebIdentityToken: openIdToken,
      DurationSeconds: 3600
    }));
    console.log('AssumeRoleWithWebIdentity response:', assumeRoleRes);

    return {
      channelARN: environment.kvs_channel_arn,
      accessKeyId: assumeRoleRes.Credentials?.AccessKeyId || '',
      secretAccessKey: assumeRoleRes.Credentials?.SecretAccessKey || '',
      sessionToken: assumeRoleRes.Credentials?.SessionToken || '',
      region: environment.region
    };
  }

  /**
   * 初始化 Transcribe Streaming Client
   */
  private async initTranscribeClient() {
    try {
      const cfg = await this.getAwsConfig();
      this.transcribeClient = new TranscribeStreamingClient({
        region: cfg.region,
        credentials: {
          accessKeyId: cfg.accessKeyId,
          secretAccessKey: cfg.secretAccessKey,
          sessionToken: cfg.sessionToken,
        },
      });
      console.log('Transcribe Client 已初始化');
    } catch (error) {
      console.error('初始化 Transcribe Client 失敗:', error);
    }
  }

  /**
   * 開始即時轉錄（在 RTC 連線完成後自動調用）
   */
  async startTranscription() {
    if (this.isTranscribing) return;

    try {
      this.isTranscribing = true;

      // 如果 client 還沒初始化，再次嘗試初始化
      if (!this.transcribeClient) {
        await this.initTranscribeClient();
      }

      // 初始化音訊分析和合併
      this.audioContext = new AudioContext({ sampleRate: 16000 });
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 512;

      // 創建音訊合併流
      this.transcribeStream = await this.createCombinedAudioStream();

      const source = this.audioContext.createMediaStreamSource(this.transcribeStream);
      source.connect(this.analyser);

      // 開始聲音檢測，只在有聲音時啟動轉錄
      this.startSoundDetection();

      console.log('轉錄系統已準備就緒，等待聲音觸發');

    } catch (error) {
      console.error('啟動轉錄系統失敗:', error);
      this.isTranscribing = false;
    }
  }

  /**
   * 創建合併的音訊流（本地 + 遠端）- 簡化版本
   */
  private async createCombinedAudioStream(): Promise<MediaStream> {
    const audioContext = new AudioContext({ sampleRate: 16000 });
    const destination = audioContext.createMediaStreamDestination();

    // 合併本地音訊
    if (this.localStream && this.localStream.getAudioTracks().length > 0) {
      const localSource = audioContext.createMediaStreamSource(this.localStream);
      localSource.connect(destination);
      console.log('已加入本地音訊到轉錄流');
    }

    // 合併遠端音訊
    if (this.remoteStream && this.remoteStream.getAudioTracks().length > 0) {
      const remoteSource = audioContext.createMediaStreamSource(this.remoteStream);
      remoteSource.connect(destination);
      console.log('已加入遠端音訊到轉錄流');
    } else {
      console.log('遠端音訊流尚未可用，僅使用本地音訊');
    }

    return destination.stream;
  }

  /**
   * 開始 Transcribe 串流 - 改用 PCM 格式
   */
  private async startTranscriptionStream() {
    if (this.isTranscribeStreamActive || !this.transcribeStream) return;

    try {
      this.isTranscribeStreamActive = true;
      console.log('開始 Transcribe 串流');

      const audioStream = this.createAudioStream();

      const command = new StartStreamTranscriptionCommand({
        LanguageCode: 'zh-TW',
        MediaSampleRateHertz: 16000,
        MediaEncoding: 'pcm', // 改用 PCM 格式
        AudioStream: audioStream,
      });

      const response = await this.transcribeClient.send(command);
      console.log('Transcribe 串流已建立，使用 PCM 格式');

      if (response.TranscriptResultStream) {
        for await (const event of response.TranscriptResultStream) {
          if (!this.isTranscribeStreamActive) break;

          if (event.TranscriptEvent?.Transcript?.Results) {
            for (const result of event.TranscriptEvent.Transcript.Results) {
              if (result.Alternatives && result.Alternatives[0]) {
                const transcript = result.Alternatives[0].Transcript || '';
                const isPartial = !result.IsPartial;

                if (transcript.trim()) {
                  if (isPartial) {
                    this.transcriptionText += transcript + ' ';
                    console.log('✅ 完整轉錄:', transcript);
                  } else {
                    //this.transcriptionText = transcript
                    //console.log('🔄 部分轉錄:', transcript);
                  }
                }
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('轉錄串流錯誤:', error);
      this.isTranscribeStreamActive = false;
    }
  }

  /**
   * 創建音訊串流 - 直接使用 PCM 格式
   */
  private createAudioStream(): AsyncIterable<AudioStream> {
    if (!this.transcribeStream) {
      throw new Error('音訊流未初始化');
    }

    let isActive = true;
    const self = this;
    let lastDataTime = Date.now();

    return {
      async *[Symbol.asyncIterator]() {
        try {
          // 直接使用 Web Audio API 處理音訊流
          const audioContext = new AudioContext({ sampleRate: 16000 });
          const source = audioContext.createMediaStreamSource(self.transcribeStream);
          const processor = audioContext.createScriptProcessor(4096, 1, 1);

          let audioChunks: Float32Array[] = [];

          processor.onaudioprocess = (event) => {
            const inputData = event.inputBuffer.getChannelData(0);
            audioChunks.push(new Float32Array(inputData));
          };

          source.connect(processor);
          processor.connect(audioContext.destination);

          console.log('開始直接 PCM 音訊處理');

          while (isActive && self.isTranscribeStreamActive) {
            await new Promise(resolve => setTimeout(resolve, 250));

            const currentTime = Date.now();

            if (audioChunks.length > 0) {
              // 處理累積的音訊資料
              const chunk = audioChunks.shift()!;

              try {
                // 直接轉換 Float32 到 16-bit PCM
                const pcmData = self.convertFloat32ToPCM(chunk);

                if (pcmData.length > 16384) {
                  const truncatedData = pcmData.slice(0, 16384);
                  yield {
                    AudioEvent: {
                      AudioChunk: truncatedData
                    }
                  };
                } else {
                  yield {
                    AudioEvent: {
                      AudioChunk: pcmData
                    }
                  };
                }

                lastDataTime = currentTime;
                console.log('已發送 PCM 音訊資料，大小:', Math.min(pcmData.length, 16384));
              } catch (error) {
                console.error('處理音訊塊錯誤:', error);
              }
            } else {
              // 發送 PCM 格式的靜音資料
              if (currentTime - lastDataTime > 5000) {
                const silencePCM = new Int16Array(256).fill(0);
                yield {
                  AudioEvent: {
                    AudioChunk: new Uint8Array(silencePCM.buffer)
                  }
                };
                lastDataTime = currentTime;
                console.log('發送 PCM 靜音資料保持連線');
              }
            }
          }

          // 清理資源
          processor.disconnect();
          source.disconnect();
          audioContext.close();

        } catch (error) {
          console.error('音訊串流錯誤:', error);
        } finally {
          isActive = false;
        }
      }
    };
  }

  /**
   * 將 Float32 音訊資料直接轉換為 PCM 格式
   */
  private convertFloat32ToPCM(float32Data: Float32Array): Uint8Array {
    try {
      // 轉換為 16-bit PCM
      const pcmData = new Int16Array(float32Data.length);
      for (let i = 0; i < float32Data.length; i++) {
        // 將 float32 (-1.0 to 1.0) 轉換為 int16 (-32768 to 32767)
        const sample = Math.max(-1, Math.min(1, float32Data[i]));
        pcmData[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      }

      // 返回 PCM 資料的 Uint8Array 視圖
      return new Uint8Array(pcmData.buffer);
    } catch (error) {
      console.error('Float32 to PCM 轉換失敗:', error);

      // 如果轉換失敗，返回靜音資料
      const silenceData = new Int16Array(1024).fill(0);
      return new Uint8Array(silenceData.buffer);
    }
  }

  /**
   * 更新轉錄流（當遠端音訊連接後調用）- 簡化版本
   */
  private async updateTranscribeStream() {
    if (!this.isTranscribing) return;

    try {
      // 停止現有轉錄
      this.stopTranscriptionStream();

      // 等待一下再重新開始
      setTimeout(async () => {
        if (this.transcribeStream) {
          this.transcribeStream.getTracks().forEach(track => track.stop());
        }

        this.transcribeStream = await this.createCombinedAudioStream();

        if (this.audioContext && this.analyser) {
          const source = this.audioContext.createMediaStreamSource(this.transcribeStream);
          source.connect(this.analyser);
        }

        this.startTranscriptionStream();
        console.log('轉錄流已更新');
      }, 2000);

    } catch (error) {
      console.error('更新轉錄流失敗:', error);
    }
  }

  /**
   * 停止 Transcribe 串流
   */
  private stopTranscriptionStream() {
    if (!this.isTranscribeStreamActive) return;

    this.isTranscribeStreamActive = false;
    this.currentTranscribeCommand = null;

    if (this.transcribeMediaRecorder && this.transcribeMediaRecorder.state === 'recording') {
      this.transcribeMediaRecorder.stop();
    }

  }

  /**
   * 停止即時轉錄
   */
  stopTranscription() {
    this.isTranscribing = false;
    this.soundDetectionActive = false;
    this.stopTranscriptionStream();

    if (this.transcribeStream) {
      this.transcribeStream.getTracks().forEach(track => track.stop());
    }

    if (this.audioContext) {
      this.audioContext.close();
    }

    console.log('即時轉錄已停止');
    console.log('完整轉錄文字:', this.transcriptionText);
    this.clearTranscription();
  }

  /**
   * 清除轉錄文字
   */
  clearTranscription() {
    this.transcriptionText = '';
  }

  /**
   * 聲音檢測
   */
  private startSoundDetection() {
    if (!this.analyser) return;

    this.soundDetectionActive = true;
    const dataArray = new Uint8Array(this.analyser.fftSize);
    const threshold = 6; // 聲音檢測閾值
    let silenceCounter = 0;
    let soundCounter = 0;
    const silenceThreshold = 120; // 約2秒的靜音後停止轉錄
    const soundThreshold = 1; // 需要連續檢測到聲音3次才啟動

    const detectSound = () => {
      if (!this.soundDetectionActive) return;

      this.analyser.getByteTimeDomainData(dataArray);

      let total = 0;
      for (let i = 0; i < dataArray.length; i++) {
        total += Math.abs(dataArray[i] - 128);
      }

      const average = total / dataArray.length;

      if (average > threshold) {
        soundCounter++;
        silenceCounter = 0;

        // 需要連續檢測到聲音才啟動轉錄
        if (soundCounter >= soundThreshold && !this.isTranscribeStreamActive) {
          console.log("🎤 連續檢測到聲音 - 啟動轉錄");
          this.startTranscriptionStream();
        }
      } else {
        soundCounter = 0;
        silenceCounter++;

        // 連續靜音一段時間後停止轉錄串流
        if (silenceCounter > silenceThreshold && this.isTranscribeStreamActive) {
          console.log("🤫 持續靜音 - 停止轉錄串流");
          this.stopTranscriptionStream();
          this.clearTranscription();
        }
      }

      requestAnimationFrame(detectSound);
    };

    detectSound();
  }

  /**
   * 初始化 Kinesis Video Client
   * @param cfg
   * @returns
   */
  private createKinesisVideoClient(cfg: AwsConfig): KinesisVideoClient {
    return new KinesisVideoClient({
      region: cfg.region,
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
        sessionToken: cfg.sessionToken,
      },
    });
  }

  /**
   * 初始化 Signaling Client
   * 注意：KVSWebRTC.SignalingClient 來自 window，型別需用 any 或自訂
   * @param cfg
   * @param wssEndpoint
   * @param role
   * @param clientId
   * @returns
   */
  private createSignalingClient(cfg: AwsConfig, wssEndpoint: string, role: Role, clientId?: string): any {
    return new KVSWebRTC.SignalingClient({
      channelARN: cfg.channelARN,
      channelEndpoint: wssEndpoint,
      role,
      clientId,
      region: cfg.region,
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
        sessionToken: cfg.sessionToken
      },
      systemClockOffset: 0,
    });
  }

  /**
   * 取得 ICE Servers
   * @param cfg
   * @param httpsEndpoint
   * @returns
   */
  private async getIceServers(cfg: AwsConfig, httpsEndpoint: string): Promise<RTCIceServer[]> {
    const kinesisVideoSignalingClient = new KinesisVideoSignalingClient({
      region: cfg.region,
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
        sessionToken: cfg.sessionToken,
      },
      endpoint: httpsEndpoint,
    });
    const command = new GetIceServerConfigCommand({ ChannelARN: cfg.channelARN });
    const response = await kinesisVideoSignalingClient.send(command);
    const iceServers: RTCIceServer[] = [{ urls: `stun:stun.kinesisvideo.${cfg.region}.amazonaws.com:443` }];
    response.IceServerList?.forEach(iceServer =>
      iceServers.push({
        urls: iceServer.Uris as string[] | string,
        username: iceServer.Username,
        credential: iceServer.Password,
      })
    );
    return iceServers;
  }

  /**
   * 取得 signaling channel endpoint
   * @param cfg
   * @param role
   * @returns
   */
  private async getSignalingChannelEndpoint(cfg: AwsConfig, role: Role) {
    const client = this.createKinesisVideoClient(cfg);
    const command = new GetSignalingChannelEndpointCommand({
      ChannelARN: cfg.channelARN,
      SingleMasterChannelEndpointConfiguration: {
        Protocols: ['WSS', 'HTTPS'],
        Role: role,
      },
    });
    return await client.send(command);
  }

  /**
   * Viewer 端點擊開始連線
   */
  async onclickViewer() {
    this.mode = 'viewer';
    const cfg = await this.getAwsConfig();
    const clientId = Math.floor(Math.random() * 999999).toString();

    const endpoints = await this.getSignalingChannelEndpoint(cfg, Role.VIEWER);
    const httpsEndpoint = endpoints.ResourceEndpointList?.find(x => x.Protocol === 'HTTPS')?.ResourceEndpoint ?? '';
    const wssEndpoint = endpoints.ResourceEndpointList?.find(x => x.Protocol === 'WSS')?.ResourceEndpoint ?? '';
    const iceServers = await this.getIceServers(cfg, httpsEndpoint);
    const peerConnection = new RTCPeerConnection({ iceServers });
    const signalingClient = this.createSignalingClient(cfg, wssEndpoint, Role.VIEWER, clientId);

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
      await this.startTranscription();
    });
    signalingClient.on('iceCandidate', candidate => {
      peerConnection.addIceCandidate(candidate);
    });
    signalingClient.on('close', () => { });
    signalingClient.on('error', error => { console.log('error', error); });
    peerConnection.addEventListener('icecandidate', ({ candidate }) => {
      if (candidate) signalingClient.sendIceCandidate(candidate);
    });
    peerConnection.addEventListener('track', event => {
      this.remoteView.nativeElement.srcObject = event.streams[0];
      this.remoteStream = event.streams[0];

      this.updateTranscribeStream();
    });
    signalingClient.open();
  }

  /**
   * Master 端點擊開始連線
   */
  async onclickMaster() {
    this.mode = 'master';
    const cfg = await this.getAwsConfig();
    let remoteId = '';
    const endpoints = await this.getSignalingChannelEndpoint(cfg, Role.MASTER);
    const httpsEndpoint = endpoints.ResourceEndpointList?.find(x => x.Protocol === 'HTTPS')?.ResourceEndpoint ?? '';
    const wssEndpoint = endpoints.ResourceEndpointList?.find(x => x.Protocol === 'WSS')?.ResourceEndpoint ?? '';
    const iceServers = await this.getIceServers(cfg, httpsEndpoint);
    const peerConnection = new RTCPeerConnection({ iceServers, iceTransportPolicy: 'all' });
    const signalingClient = this.createSignalingClient(cfg, wssEndpoint, Role.MASTER);

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
      await this.startTranscription();
    });
    signalingClient.on('iceCandidate', candidate => {
      peerConnection.addIceCandidate(candidate);
    });
    signalingClient.on('close', () => { });
    signalingClient.on('error', error => { console.log('error', error); });
    peerConnection.addEventListener('icecandidate', ({ candidate }) => {
      if (candidate) signalingClient.sendIceCandidate(candidate, remoteId);
    });
    peerConnection.addEventListener('track', event => {
      this.remoteView.nativeElement.srcObject = event.streams[0];
      this.remoteStream = event.streams[0];

      // 當遠端音訊可用時，更新轉錄流
      this.updateTranscribeStream();
    });
    signalingClient.open();
  }

  /**
   * 錄音流程
   * 注意：此方法會使用 AudioContext 來處理音訊流，並將本地和遠端音訊流合併後進行錄音。
   * @returns
   */
  async startRecording() {
    this.isRecording = true;
    if (!this.localStream) {
      console.error('Local stream is not available for recording.');
      return;
    }
    const audioContext = new AudioContext();
    const destination = audioContext.createMediaStreamDestination();
    const localSource = audioContext.createMediaStreamSource(this.localStream);
    localSource.connect(destination);
    if (this.remoteStream && this.remoteStream.getAudioTracks().length > 0) {
      const remoteSource = audioContext.createMediaStreamSource(this.remoteStream);
      remoteSource.connect(destination);
    }
    const combinedStream = destination.stream;
    this.mediaRecorder = new MediaRecorder(combinedStream, { mimeType: 'audio/webm' });
    this.recordedChunks = [];
    this.mediaRecorder.ondataavailable = e => {
      if (e.data.size > 0) this.recordedChunks.push(e.data);
    };
    this.mediaRecorder.onstop = async () => {
      const fileName = `recording-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}.webm`;
      const blob = new Blob(this.recordedChunks, { type: 'audio/webm' });
      this.downloadBlob(blob, fileName);
      await this.uploadToS3(blob, fileName);
    };
    this.mediaRecorder.start();
  }

  /**
   * 停止錄音
   */
  stopRecording() {
    this.isRecording = false;
    this.mediaRecorder?.stop();
  }

  /**
   * 下載 Blob，測試用
   * @param blob
   * @param fileName
   */
  private downloadBlob(blob: Blob, fileName: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
  }

  /**
   * 將音訊上傳到 S3
   * @param blob
   * @param fileName
   */
  private async uploadToS3(blob: Blob, fileName: string) {
    this.isUploading = true;
    const cfg = await this.getAwsConfig();
    const client = new S3Client({
      region: cfg.region,
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
        sessionToken: cfg.sessionToken,
      },
      forcePathStyle: true,
      requestHandler: { requestTimeout: 0, httpsAgent: undefined }
    });
    const arrayBuffer = await blob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    const bucketName = environment.audioBucketName;
    const putCommand = new PutObjectCommand({
      Bucket: bucketName,
      Key: fileName,
      Body: uint8Array,
      ContentType: 'audio/webm',
    });
    try {
      const result = await client.send(putCommand);
      console.log('Successfully uploaded to S3:', result);
    } catch (caught) {
      console.error('Upload failed:', caught);
      console.log('Falling back to local download only');
    } finally {
      this.isUploading = false;
    }
  }

  /**
 * 切換聊天室顯示狀態
 */
  toggleChat() {
    this.isChatOpen = !this.isChatOpen;
  }

  /**
   * 發送聊天訊息
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
      // 調用 API Gateway 聊天 API
      const response = await this.http.post(environment.chatUrl, {
        Message: messageToSend,
        SessionId: this.sessionId
      }, {
        responseType: 'text'
      }).toPromise();

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
   * 處理 Enter 鍵發送訊息
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
   */
  private scrollToBottom() {
    const chatContainer = document.querySelector('.chat-messages');
    if (chatContainer) {
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }
  }

  /**
   * 清除聊天記錄
   */
  clearChat() {
    this.chatMessages = [];
    this.sessionId = this.generateSessionId();
  }
}
