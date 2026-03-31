import {
  Body,
  Controller,
  Delete,
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

  @Delete('sessions/:id')
  async deleteSession(@Param('id') id: string) {
    await this.chatHistory.deleteSession(id);
    return { ok: true };
  }

  @Get('chat')
  async chat(
    @Query('query') query: string,
    @Query('sessionId') sessionId?: string,
  ) {
    return this.aiService.runChain(query, sessionId);
  }

  @Sse('chat/stream')
  chatStream(
    @Query('query') query: string,
    @Query('sessionId') sessionId: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Observable<MessageEvent> {
    // SSE handler must be sync; require sessionId from client
    const sid = sessionId;
    if (!sid) {
      res.setHeader('X-Session-Id', '');
      return from(['缺少 sessionId，请先创建会话后再发起流式对话。']).pipe(
        map((chunk) => ({ data: chunk })),
      );
    }
    res.setHeader('X-Session-Id', sid);
    const stream = this.aiService.runChainStream(query, sid);

    return from(stream).pipe(
      map((chunk) => ({
        data: chunk,
      })),
    );
  }
}
