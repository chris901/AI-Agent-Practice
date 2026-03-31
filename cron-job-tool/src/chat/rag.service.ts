import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAIEmbeddings } from '@langchain/openai';
import { EntityManager } from 'typeorm';
import { RagChunk } from './entities/rag-chunk.entity';
import { MilvusService } from '../vector/milvus.service';

function chunkText(text: string, maxLen = 500): string[] {
  const t = text.trim();
  if (!t) return [];
  const chunks: string[] = [];
  for (let i = 0; i < t.length; i += maxLen) {
    chunks.push(t.slice(i, i + maxLen));
  }
  return chunks;
}

@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);
  private readonly embeddings: OpenAIEmbeddings | null;
  private readonly vectorDim: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly entityManager: EntityManager,
    private readonly milvus: MilvusService,
  ) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      this.embeddings = null;
      this.vectorDim = Number(this.configService.get('VECTOR_DIM') ?? 1024);
      return;
    }
    this.vectorDim = Number(this.configService.get('VECTOR_DIM') ?? 1024);
    this.embeddings = new OpenAIEmbeddings({
      model:
        this.configService.get<string>('EMBEDDINGS_MODEL_NAME') ??
        'text-embedding-v3',
      apiKey,
      configuration: {
        baseURL: this.configService.get<string>('OPENAI_BASE_URL'),
      },
      dimensions: this.vectorDim,
    });
  }

  async indexSessionTurn(
    sessionId: string,
    userText: string,
    assistantText: string,
  ): Promise<void> {
    if (!this.embeddings) return;
    const rows: Partial<RagChunk>[] = [];
    const milvusRows: {
      id: string;
      session_id: string;
      role: 'user' | 'assistant';
      index: number;
      content: string;
      vector: number[];
    }[] = [];

    const addChunks = async (role: 'user' | 'assistant', raw: string) => {
      const parts = chunkText(raw);
      for (let i = 0; i < parts.length; i++) {
        const content = parts[i];
        try {
          const vec = await this.embeddings!.embedQuery(content);
          // MySQL 侧：保留元数据（embeddingJson 可选：便于回退/对照）
          rows.push({
            sessionId,
            role,
            content,
            embeddingJson: JSON.stringify(vec),
          });

          // Milvus 侧：向量索引主路径
          milvusRows.push({
            id: `${sessionId}_${Date.now()}_${role}_${i}_${Math.random().toString(16).slice(2)}`,
            session_id: sessionId,
            role,
            index: i,
            content,
            vector: vec,
          });
        } catch (e) {
          this.logger.warn(`embed chunk failed: ${(e as Error).message}`);
        }
      }
    };

    await addChunks('user', userText);
    await addChunks('assistant', assistantText);

    if (!rows.length) return;

    // 先写 Milvus（在线检索依赖它），失败不影响主链路
    try {
      await this.milvus.insertRagChunks(milvusRows);
    } catch (e) {
      this.logger.warn(`milvus insert failed: ${(e as Error).message}`);
    }

    // MySQL 元数据写入（可用于审计/回退）
    try {
      await this.entityManager.save(
        RagChunk,
        rows.map((r) => this.entityManager.create(RagChunk, r)),
      );
    } catch (e) {
      this.logger.warn(`mysql rag save failed: ${(e as Error).message}`);
    }
  }

  async retrieveContext(
    sessionId: string,
    query: string,
    topK = 4,
  ): Promise<string> {
    const q = query.trim();
    if (!q || !this.embeddings) return '';

    let queryVec: number[];
    try {
      queryVec = await this.embeddings.embedQuery(q);
    } catch (e) {
      this.logger.warn(`embed query failed: ${(e as Error).message}`);
      return '';
    }

    // 主路径：Milvus 向量检索（仅当前 sessionId）
    try {
      const hits = await this.milvus.searchBySessionId(
        sessionId,
        queryVec,
        topK,
      );
      const picked = hits
        .map((h) => ({
          role:
            h.role === 'user' || h.role === 'assistant' ? h.role : 'unknown',
          content: h.content ?? '',
        }))
        .filter((x) => x.content);
      if (picked.length) {
        return picked
          .map((p, i) => `[片段${i + 1} ${p.role}] ${p.content}`)
          .join('\n\n');
      }
    } catch (e) {
      this.logger.warn(`milvus search failed: ${(e as Error).message}`);
    }

    // 降级：若 Milvus 不可用，回退到 MySQL 最近片段（不做向量相似度）
    try {
      const chunks = await this.entityManager.find(RagChunk, {
        where: { sessionId },
        order: { createdAt: 'DESC' },
        take: topK,
      });
      if (!chunks.length) return '';
      return chunks
        .map((c, i) => `[片段${i + 1} ${c.role}] ${c.content}`)
        .join('\n\n');
    } catch (e) {
      this.logger.warn(`mysql rag fallback failed: ${(e as Error).message}`);
      return '';
    }
  }

  async deleteSessionVectors(sessionId: string): Promise<void> {
    try {
      await this.milvus.deleteBySessionId(sessionId);
    } catch (e) {
      this.logger.warn(`milvus delete failed: ${(e as Error).message}`);
      throw e;
    }
  }
}
