import { Component, ElementRef, ViewChild } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { environment } from '../environments/environment';
import { CognitoIdentityClient, GetIdCommand, GetOpenIdTokenCommand } from '@aws-sdk/client-cognito-identity';
import { STSClient, AssumeRoleWithWebIdentityCommand } from '@aws-sdk/client-sts';
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { KinesisVideoClient, GetSignalingChannelEndpointCommand } from '@aws-sdk/client-kinesis-video';
import { KinesisVideoSignalingClient, GetIceServerConfigCommand } from '@aws-sdk/client-kinesis-video-signaling';
import { Role } from './kvsRole';
import { AwsConfig } from './aws.config';
const KVSWebRTC = (window as any).KVSWebRTC;

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  @ViewChild("remoteView", { static: true }) remoteView: ElementRef = new ElementRef(null);

  localStream!: MediaStream;
  remoteStream!: MediaStream;
  mediaRecorder!: MediaRecorder;
  recordedChunks: Blob[] = [];

  title = 'webrtc';
  mode: 'init' | 'master' | 'viewer' = 'init';
  isRecording = false;
  isUploading = false;

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
      viewerStream.getTracks().forEach(track => peerConnection.addTrack(track, viewerStream));
      await peerConnection.setLocalDescription(await peerConnection.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true }));
      signalingClient.sendSdpOffer(peerConnection.localDescription as RTCSessionDescription);
    });
    signalingClient.on('sdpAnswer', async answer => {
      await peerConnection.setRemoteDescription(answer);
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
    const endpoints = await this.getSignalingChannelEndpoint(cfg, Role.MASTER); // 或 'VIEWER'
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
      this.localStream.getTracks().forEach(track => peerConnection.addTrack(track, this.localStream));
    });
    signalingClient.on('sdpOffer', async (offer, remoteClientId) => {
      remoteId = remoteClientId;
      await peerConnection.setRemoteDescription(offer);
      await peerConnection.setLocalDescription(await peerConnection.createAnswer({ offerToReceiveAudio: true, offerToReceiveVideo: true }));
      signalingClient.sendSdpAnswer(peerConnection.localDescription as RTCSessionDescription, remoteId);
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
}
