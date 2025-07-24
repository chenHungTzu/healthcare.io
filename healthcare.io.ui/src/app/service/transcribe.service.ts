import { TranslateService } from './translate.service';
import { AudioService } from './audio.service';
import { Injectable } from '@angular/core';
import { AudioStream, LanguageCode, StartStreamTranscriptionCommand, TranscribeStreamingClient } from '@aws-sdk/client-transcribe-streaming';
import { BehaviorSubject } from 'rxjs';
import { AwsConfigService } from './aws-config.service';


@Injectable({
  providedIn: 'root',
})
export class TranscribeService {
  transcribeClient!: TranscribeStreamingClient;
  isTranscribing = false;
  audioContext!: AudioContext;
  analyser!: AnalyserNode;
  currentTranscribeCommand: any = null;
  transcribeStream!: MediaStream; // 用於轉錄的音訊流
  transcribeMediaRecorder!: MediaRecorder; // 替換 audioProcessor
  soundDetectionActive = false;
  isTranscribeStreamActive = false;

  transcribeText: BehaviorSubject<string> = new BehaviorSubject<string>('');
  transcribeLanguageCode: BehaviorSubject<string> = new BehaviorSubject<string>('zh-TW'); // 默認轉錄語言


  constructor(private awsConfigService: AwsConfigService,
    private audioService: AudioService,
    private translateService: TranslateService) {
    this.initTranscribeClient().then(() => {
      console.log('Transcribe Client 初始化完成');
    }).catch(error => {
      console.error('Transcribe Client 初始化失敗:', error);
    });
  }


  setTranscribeLanguage(languageCode: string) {
    this.transcribeLanguageCode.next(languageCode);
  }

  /**
     * 初始化 Transcribe Streaming Client
     */
  private async initTranscribeClient() {

    const cfg = await this.awsConfigService.getConfig();
    this.transcribeClient = new TranscribeStreamingClient({
      region: cfg.region,
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
        sessionToken: cfg.sessionToken,
      },
    });
  }


  /**
   * 停止轉錄系統
   * @returns Promise<void>
   */
  public async stopTranscribing() {
    if (!this.isTranscribing) return;

    try {

      this.isTranscribing = false;

      this.stopSoundDetection();

      // 停止音訊流
      if (this.transcribeStream) {
        this.transcribeStream.getTracks().forEach(track => track.stop());
      }
      // 停止音訊處理
      if (this.audioContext) {
        this.audioContext.close();
        this.audioContext = undefined as any; // 清理 AudioContext
      }
      // 停止轉錄串流
      this.stopTranscriptionStream();

      // 清空轉錄文字
      this.clearTranscription();

      console.log('轉錄系統已停止');
    } catch (error) {
      console.error('停止轉錄系統失敗:', error);
      this.isTranscribing = false;
    }
  }

  /**
   * 開始即時轉錄
   * @param localStream
   * @param remoteStream
   * @returns
   */
  public async startTranscription(localStream: MediaStream, remoteStream: MediaStream): Promise<void> {
    if (this.isTranscribing) return;

    try {
      this.isTranscribing = true;

      // 初始化音訊分析和合併
      this.audioContext = new AudioContext({ sampleRate: 16000 }); // 設定音訊採樣率為 16000Hz
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 512;  // 時域樣本數

      // 創建音訊合併流
      this.transcribeStream = this.audioService.createCombinedAudioStream(localStream, remoteStream);

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
   * 停止聲音檢測
   */
  private stopSoundDetection(): void {
    this.soundDetectionActive = false;
    console.log('聲音檢測已停止');
  }

  /**
   * 開始聲音檢測
   * @returns
   */
  private startSoundDetection(): void {
    if (!this.analyser) return;

    this.soundDetectionActive = true;
    const dataArray = new Uint8Array(this.analyser.fftSize);
    const threshold = 4; // 聲音檢測閾值
    let silenceCounter = 0;
    let soundCounter = 0;
    const silenceThreshold = 200;
    const soundThreshold = 1;

    const detectSound = () => {
      if (!this.soundDetectionActive) return;

      // 快照音訊數據
      this.analyser.getByteTimeDomainData(dataArray);

       // 🎵 音訊振幅與 Uint8Array 值的對應關係：
      // ┌─────────────────────┬──────────────┬──────────────────┐
      // │ 原始音訊振幅        │ Uint8Array值 │ 與128的偏差      │
      // ├─────────────────────┼──────────────┼──────────────────┤
      // │ +1.0 (最大正音量)   │     255      │ 偏差 = 127       │
      // │  0.0 (靜音基準)     │     128      │ 偏差 = 0         │
      // │ -1.0 (最大負音量)   │      0       │ 偏差 = 128       │
      // └─────────────────────┴──────────────┴──────────────────┘
      //
      // 計算邏輯：Math.abs(dataArray[i] - 128)
      // - 128 是靜音的基準點（零振幅）
      // - 偏差值越大 = 音訊活動越明顯
      // - 正負振幅都代表聲音活動，所以使用絕對值
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
     * 開始 Transcribe 串流
     */
  private async startTranscriptionStream(): Promise<void> {
    if (this.isTranscribeStreamActive || !this.transcribeStream) return;

    try {
      this.isTranscribeStreamActive = true;
      console.log('開始 Transcribe 串流');

      const audioStream = this.createAudioStream();

      const command = new StartStreamTranscriptionCommand({
        // IdentifyLanguage: true,
        // LanguageOptions: 'zh-TW,en-US',
        // PreferredLanguage: this.defaultLanguageCode,
        LanguageCode: this.transcribeLanguageCode.value as LanguageCode,
        MediaSampleRateHertz: 16000,
        MediaEncoding: 'pcm',
        AudioStream: audioStream,
      });

      const response = await this.transcribeClient.send(command);

      if (response.TranscriptResultStream) {
        for await (const event of response.TranscriptResultStream) {

          if (!this.isTranscribeStreamActive) break;

          if (event.TranscriptEvent?.Transcript?.Results) {
            for (const result of event.TranscriptEvent.Transcript.Results) {
              if (result.Alternatives && result.Alternatives[0]) {
                const transcript = result.Alternatives[0].Transcript || '';

                if (!transcript.trim()) continue;

                if (result.IsPartial) {
                  console.log('✅ 部分轉錄:', transcript);
                } else {
                  console.log('✅ 完整轉錄:', transcript);
                  this.translateService.translateText(transcript).then(translatedText => {
                    console.log('翻譯結果:', translatedText);
                    this.transcribeText.next(this.transcribeText.value + translatedText + ' ');
                  });
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
   * 更新轉錄串流
   * @param localStream
   * @param remoteStream
   * @returns
   */
  public async updateTranscribeStream(localStream: MediaStream, remoteStream: MediaStream) {
    if (!this.isTranscribing) return;

    try {
      // 停止現有轉錄
      this.stopTranscriptionStream();

      // 等待一下再重新開始
      setTimeout(async () => {
        if (this.transcribeStream) {
          this.transcribeStream.getTracks().forEach(track => track.stop());
        }

        this.transcribeStream = this.audioService.createCombinedAudioStream(localStream, remoteStream);

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
   * 清空轉錄文字
   */
  private clearTranscription() {
    this.transcribeText.next('');
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
}

