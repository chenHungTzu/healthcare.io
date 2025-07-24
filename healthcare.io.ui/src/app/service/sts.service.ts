import { Injectable } from '@angular/core';
import { AwsConfig } from '../aws.config';
import { environment } from '../../environments/environment';
import { CognitoIdentityClient, GetIdCommand, GetOpenIdTokenCommand } from '@aws-sdk/client-cognito-identity';
import { AssumeRoleWithWebIdentityCommand, STSClient } from '@aws-sdk/client-sts';

@Injectable({
  providedIn: 'root'
})
export class StsService {

  private configCache: AwsConfig | null = null;
  private configPromise: Promise<AwsConfig> | null = null;

  /**
    * 取得 AWS 設定（動態取得臨時憑證）
    * @returns
    */
  public async getAwsConfig(): Promise<AwsConfig> {
    // 如果已有快取且憑證尚未過期，直接回傳
    if (this.configCache) {
      return this.configCache;
    }

    // 如果正在取得設定中，回傳相同的 Promise
    if (this.configPromise) {
      return this.configPromise;
    }

    this.configPromise = this.fetchAwsConfig();
    this.configCache = await this.configPromise;
    this.configPromise = null;

    return this.configCache;
  }

  private async fetchAwsConfig(): Promise<AwsConfig> {

    // 1. 產生臨時ID (未授權身份)
    const cognitoIdentity = new CognitoIdentityClient({ region: environment.region });
    const identityPoolId = environment.identity_pool_id;
    const getIdRes = await cognitoIdentity.send(new GetIdCommand({ IdentityPoolId: identityPoolId }));
    const identityId = getIdRes.IdentityId!;

    // 2. 取得 token
    const getTokenRes = await cognitoIdentity.send(new GetOpenIdTokenCommand({ IdentityId: identityId }));
    const openIdToken = getTokenRes.Token!;

    // 3. 取得臨時憑證
    const sts = new STSClient({ region: environment.region });
    const roleSessionName = Math.floor(Math.random() * 100000).toString().padStart(5, '0');
    const assumeRoleRes = await sts.send(new AssumeRoleWithWebIdentityCommand({
      RoleArn: environment.kvs_role_arn,
      RoleSessionName: roleSessionName,
      WebIdentityToken: openIdToken,
      DurationSeconds: 3600
    }));

    return {
      channelARN: environment.kvs_channel_arn,
      accessKeyId: assumeRoleRes.Credentials?.AccessKeyId || '',
      secretAccessKey: assumeRoleRes.Credentials?.SecretAccessKey || '',
      sessionToken: assumeRoleRes.Credentials?.SessionToken || '',
      region: environment.region
    };
  }

  /**
   * 清除快取（當憑證過期時使用）
   */
  public clearCache(): void {
    this.configCache = null;
  }
}
