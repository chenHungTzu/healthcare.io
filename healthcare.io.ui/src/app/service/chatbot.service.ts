import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class ChatbotService {

  constructor(private http: HttpClient) { }

  /**
   * 發送訊息到聊天 API
   * @param messageToSend 要發送的訊息
   * @param sessionId 聊天會話 ID
   * @returns 聊天 API 的回應
   */
  public async SendMessage(messageToSend: string, sessionId: string): Promise<string> {
    // 調用 API Gateway 聊天 API
    const response = await this.http.post(environment.chatUrl, {
      Message: messageToSend,
      SessionId: sessionId
    }, {
      responseType: 'text'
    }).toPromise();

    return response;
  }
}
