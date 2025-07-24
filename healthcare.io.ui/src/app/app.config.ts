import { ApplicationConfig, APP_INITIALIZER, importProvidersFrom } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { provideHttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { AwsConfigService } from './service/aws-config.service';

function initializeAwsConfig(awsConfigService: AwsConfigService) {
  return () => awsConfigService.getConfig();
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideHttpClient(),
    importProvidersFrom(FormsModule),
    DatePipe,
    {
      provide: APP_INITIALIZER,
      useFactory: initializeAwsConfig,
      deps: [AwsConfigService],
      multi: true
    }
  ]
};
