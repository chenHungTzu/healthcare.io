import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { AwsConfigService } from './aws-config.service';

@Injectable({
  providedIn: 'root'
})
export class S3Service {

  private s3Client!: S3Client;

  constructor(private awsConfigService: AwsConfigService) {
    this.initS3Client().then(() => {
      console.log('S3 Client 初始化完成');
    }).catch(error => {
      console.error('S3 Client 初始化失敗:', error);
    })
  }
  private async initS3Client(): Promise<void> {
    const config = await this.awsConfigService.getConfig();
    this.s3Client = new S3Client({
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        sessionToken: config.sessionToken,
      },
    });
  }

  /**
     * 將音訊上傳到 S3
     * @param blob
     * @param fileName
     */
  public async upload(blob: Blob, fileName: string, contentType: string) {

    const arrayBuffer = await blob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    const bucketName = environment.audioBucketName;
    const putCommand = new PutObjectCommand({
      Bucket: bucketName,
      Key: fileName,
      Body: uint8Array,
      ContentType: contentType
    });
    try {
      const result = await this.s3Client.send(putCommand);
      console.log('Successfully uploaded to S3:', result);
    } catch (caught) {
      console.error('Upload failed:', caught);
      console.log('Falling back to local download only');
    }
  }
}
