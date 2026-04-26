import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SpeechService } from './speech.service';
import { SpeechController } from './speech.controller';
import * as tencentcloud from 'tencentcloud-sdk-nodejs';

const AsrClient = tencentcloud.asr.v20190614.Client;

@Module({
  providers: [
    SpeechService,
    {
      provide: 'ASR_CLIENT',
      useFactory: (configService: ConfigService) => {
        return new AsrClient({
          credential: {
            secretId: configService.get('SECRET_ID'),
            secretKey: configService.get('SECRET_KEY'),
          },
          region: 'ap-shanghai',
          profile: {
            httpProfile: {
              reqMethod: 'POST',
              reqTimeout: 30,
            },
          },
        });
      },
      inject: [ConfigService],
    },
  ],
  controllers: [SpeechController],
})
export class SpeechModule {}
