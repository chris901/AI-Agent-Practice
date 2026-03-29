import {
  Body,
  Controller,
  Get,
  MessageEvent,
  Param,
  Post,
  Query,
  Res,
  Sse,
} from '@nestjs/common';
import type { Response } from 'express';
import { AiService } from './ai.service';
import { ChatHistoryService } from '../chat/chat-history.service';
import { from, map, Observable } from 'rxjs';

@Controller('ai')
export class AiController {
  constructor(
    private readonly aiService: AiService,
    private readonly chatHistory: ChatHistoryService,
  ) {}

  @Post('sessions')
  async createSession(@Body() body?: { title?: string }) {
    const s = await this.chatHistory.createSession(body?.title);
    return { id: s.id };
  }

  @Get('sessions')
  async listSessions() {
    return this.chatHistory.listSessions();
  }

  @Get('sessions/:id/messages')
  async listMessages(@Param('id') id: string) {
    return this.chatHistory.listMessages(id);
  }

  @Get('chat')
  async chat(
    @Query('query') query: string,
    @Query('sessionId') sessionId?: string,
  ) {
    return this.aiService.runChain(query, sessionId);
  }

  @Sse('chat/stream')
  async chatStream(
    @Query('query') query: string,
    @Query('sessionId') sessionId: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Observable<MessageEvent>> {
    const sid = sessionId ?? (await this.chatHistory.createSession()).id;
    res.setHeader('X-Session-Id', sid);
    const stream = this.aiService.runChainStream(query, sid);

    return from(stream).pipe(
      map((chunk) => ({
        data: chunk,
      })),
    );
  }
}
