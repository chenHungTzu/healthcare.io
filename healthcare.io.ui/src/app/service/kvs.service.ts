import { Injectable } from '@angular/core';
import { Role } from '../kvsRole';
import { GetSignalingChannelEndpointCommand, KinesisVideoClient } from '@aws-sdk/client-kinesis-video';
import { GetIceServerConfigCommand, KinesisVideoSignalingClient } from '@aws-sdk/client-kinesis-video-signaling';
import { AwsConfigService } from './aws-config.service';

const KVSWebRTC = (window as any).KVSWebRTC;

@Injectable({
  providedIn: 'root'
})
export class KvsService {

  kinesisVideoClient!: KinesisVideoClient;

  constructor(private awsConfigService: AwsConfigService) {
    this.initKinesisVideoClient().then(() => {
      console.log('Kinesis Video Client 初始化完成');
    }).catch(error => {
      console.error('Kinesis Video Client 初始化失敗:', error);
    })

  }

  /**
    * 初始化 Kinesis Video Client
    * @param cfg
    * @returns
      */
  private async initKinesisVideoClient(): Promise<void> {
    const config = await this.awsConfigService.getConfig();
    this.kinesisVideoClient = new KinesisVideoClient({
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        sessionToken: config.sessionToken,
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
  public async createSignalingClient(wssEndpoint: string, role: Role, clientId?: string): Promise<any> {
    const config = await this.awsConfigService.getConfig();
    return new KVSWebRTC.SignalingClient({
      channelARN: config.channelARN,
      channelEndpoint: wssEndpoint,
      role,
      clientId,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        sessionToken: config.sessionToken
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
  public async getIceServers(httpsEndpoint: string): Promise<RTCIceServer[]> {
    const config = await this.awsConfigService.getConfig();
    const kinesisVideoSignalingClient = new KinesisVideoSignalingClient({
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        sessionToken: config.sessionToken,
      },
      endpoint: httpsEndpoint,
    });
    const command = new GetIceServerConfigCommand({ ChannelARN: config.channelARN });
    const response = await kinesisVideoSignalingClient.send(command);
    const iceServers: RTCIceServer[] = [{ urls: `stun:stun.kinesisvideo.${config.region}.amazonaws.com:443` }];
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
  public async getSignalingChannelEndpoint(role: Role) {
    const config = await this.awsConfigService.getConfig();
    const command = new GetSignalingChannelEndpointCommand({
      ChannelARN: config.channelARN,
      SingleMasterChannelEndpointConfiguration: {
        Protocols: ['WSS', 'HTTPS'],
        Role: role,
      },
    });
    return await this.kinesisVideoClient.send(command);
  }
}
