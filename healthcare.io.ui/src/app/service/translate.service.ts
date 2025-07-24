import { Injectable } from '@angular/core';
import { TranslateClient, ListLanguagesCommand, TranslateTextCommand, Language } from "@aws-sdk/client-translate";
import { AwsConfigService } from './aws-config.service';
import { BehaviorSubject } from 'rxjs';
@Injectable({
  providedIn: 'root'
})
export class TranslateService {
  private translateClient: TranslateClient;

  sourceLanguageCode: BehaviorSubject<string> = new BehaviorSubject<string>('zh-TW');
  targetLanguageCode: BehaviorSubject<string> = new BehaviorSubject<string>('zh-TW');

  languageCodes: BehaviorSubject<Language[]> = new BehaviorSubject<Language[]>([]);

  constructor(private awsConfigService: AwsConfigService) {
    this.initTranslateClient().then(() => {
      console.log('Translate Client 初始化完成');

      this.listLanguages().then(languages => {
        this.languageCodes.next(languages);
      });

    }).catch(error => {
      console.error('Translate Client 初始化失敗:', error);
    });
  }

  /**
   * 設置轉錄語言
   * @param code 語言代碼
   */
  public setTranscribeLanguage(code: string) {
    this.sourceLanguageCode.next(code);
  }

  /**
   * 設置轉譯語言
   * @param code 轉譯語言代碼
   */
  public setTranslateLanguage(code: string) {
    this.targetLanguageCode.next(code);
  }

  /**
   * 初始化翻譯客戶端
   * @returns Promise<void>
   */
  private async initTranslateClient(): Promise<void> {
    const config = await this.awsConfigService.getConfig();
    this.translateClient = new TranslateClient({
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        sessionToken: config.sessionToken,
      },
    });
  }

  /**
   * 列出可用的語言
   * @returns 可用的語言列表
   */
  public async listLanguages(): Promise<Language[]> {
    const command = new ListLanguagesCommand({});
    const response = await this.translateClient.send(command);
    return response.Languages || [];
  }

  /**
   * 翻譯文字
   * @param text 要翻譯的文字
   * @returns 翻譯後的文字
   */
  public async translateText(text: string): Promise<string> {

    const command = new TranslateTextCommand({
      Text: text,
      SourceLanguageCode: this.sourceLanguageCode.value,
      TargetLanguageCode: this.targetLanguageCode.value
    });

    const response = await this.translateClient.send(command);
    return response.TranslatedText || '';
  }
}
