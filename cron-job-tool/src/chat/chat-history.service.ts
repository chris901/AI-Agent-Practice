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
    const session = await this.getSessionOrThrow(sessionId);
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

    // 如果会话还没有标题，基于首条用户内容生成一个简短语义标题
    if (!session.title) {
      const raw = userContent.trim();
      let title = raw;
      // 取第一句或前 30 个字符，去掉多余空白
      const firstPunct = raw.search(/[。！？?!]/);
      if (firstPunct > 0) {
        title = raw.slice(0, firstPunct);
      }
      if (title.length > 30) {
        title = `${title.slice(0, 30)}...`;
      }
      if (!title) {
        title = '新的对话';
      }

      await this.entityManager.update(
        ChatSession,
        { id: sessionId },
        { title, updatedAt: new Date() },
      );
    } else {
      await this.entityManager.update(
        ChatSession,
        { id: sessionId },
        { updatedAt: new Date() },
      );
    }

    await this.ragService.indexSessionTurn(sessionId, userContent, assistantContent);
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.getSessionOrThrow(sessionId);

    // 先删除 MySQL 会话（ChatMessage 通过 onDelete=CASCADE 会被清理）
    await this.entityManager.delete(ChatSession, { id: sessionId });

    // 再删除 Milvus 向量（同步删除语义）
    await this.ragService.deleteSessionVectors(sessionId);
  }
}
