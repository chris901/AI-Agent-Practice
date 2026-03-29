import { Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { ChatSession } from './entities/chat-session.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { RagService } from './rag.service';

@Injectable()
export class ChatHistoryService {
  constructor(
    private readonly entityManager: EntityManager,
    private readonly ragService: RagService,
  ) {}

  async createSession(title?: string | null): Promise<ChatSession> {
    const session = this.entityManager.create(ChatSession, {
      title: title ?? null,
    });
    return this.entityManager.save(ChatSession, session);
  }

  async listSessions(limit = 50): Promise<ChatSession[]> {
    return this.entityManager.find(ChatSession, {
      order: { updatedAt: 'DESC' },
      take: limit,
    });
  }

  async getSessionOrThrow(id: string): Promise<ChatSession> {
    const session = await this.entityManager.findOne(ChatSession, {
      where: { id },
    });
    if (!session) {
      throw new NotFoundException(`会话不存在: ${id}`);
    }
    return session;
  }

  async listMessages(sessionId: string): Promise<ChatMessage[]> {
    await this.getSessionOrThrow(sessionId);
    return this.entityManager.find(ChatMessage, {
      where: { sessionId },
      order: { createdAt: 'ASC' },
    });
  }

  async appendExchange(
    sessionId: string,
    userContent: string,
    assistantContent: string,
  ): Promise<void> {
    await this.getSessionOrThrow(sessionId);
    await this.entityManager.save(ChatMessage, [
      this.entityManager.create(ChatMessage, {
        sessionId,
        role: 'user',
        content: userContent,
      }),
      this.entityManager.create(ChatMessage, {
        sessionId,
        role: 'assistant',
        content: assistantContent,
      }),
    ]);
    await this.entityManager.update(
      ChatSession,
      { id: sessionId },
      { updatedAt: new Date() },
    );
    await this.ragService.indexSessionTurn(sessionId, userContent, assistantContent);
  }
}
