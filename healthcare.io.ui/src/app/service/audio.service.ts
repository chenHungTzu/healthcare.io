import { BehaviorSubject } from 'rxjs';
import { Injectable } from '@angular/core';
import { S3Service } from './s3.service';


@Injectable({
  providedIn: 'root'
})
export class AudioService {

  isRecording: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);
  mediaRecorder!: MediaRecorder;
  recordedChunks: Blob[] = [];

  constructor(private s3Service: S3Service) { }

  public createCombinedAudioStream(localStream: MediaStream, remoteStream: MediaStream): MediaStream {
    const audioContext = new AudioContext({ sampleRate: 16000 });
    const destination = audioContext.createMediaStreamDestination();

    // 合併本地音訊
    if (localStream && localStream.getAudioTracks().length > 0) {
      const localSource = audioContext.createMediaStreamSource(localStream);
      localSource.connect(destination);
    }

    // 合併遠端音訊
    if (remoteStream && remoteStream.getAudioTracks().length > 0) {
      const remoteSource = audioContext.createMediaStreamSource(remoteStream);
      remoteSource.connect(destination);
    }

    return destination.stream;
  }

  /**
   * 停止錄音
   */
  stopRecording() {
    this.isRecording.next(false);
    this.mediaRecorder?.stop();
  }

  /**
   * 開始錄音
   * @param localStream
   * @param remoteStream
   * @returns
   */
  async startRecording(localStream: MediaStream, remoteStream: MediaStream): Promise<void> {
    this.isRecording.next(true);
    if (!localStream) {
      console.error('Local stream is not available for recording.');
      return;
    }

    const combinedStream = this.createCombinedAudioStream(localStream, remoteStream);
    this.mediaRecorder = new MediaRecorder(combinedStream, { mimeType: 'audio/webm' });
    this.recordedChunks = [];
    this.mediaRecorder.ondataavailable = e => {
      if (e.data.size > 0) this.recordedChunks.push(e.data);
    };
    this.mediaRecorder.onstop = async () => {
      const fileName = `recording-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}.webm`;
      const blob = new Blob(this.recordedChunks, { type: 'audio/webm' });
      this.downloadBlob(blob, fileName);
      await this.s3Service.upload(blob, fileName, 'audio/webm');
    };
    this.mediaRecorder.start();
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
}
