import { Injectable, inject } from '@angular/core';
import { StsService } from './sts.service';
import { AwsConfig } from '../aws.config';

@Injectable({
  providedIn: 'root'
})
export class AwsConfigService {

  private stsService = inject(StsService);
  private config: AwsConfig | null = null;

  async getConfig(): Promise<AwsConfig> {
    if (!this.config) {
      this.config = await this.stsService.getAwsConfig();
    }
    return this.config;
  }

  refreshConfig(): void {
    this.stsService.clearCache();
    this.config = null;
  }
}
