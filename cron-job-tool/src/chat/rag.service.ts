import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAIEmbeddings } from '@langchain/openai';
import { EntityManager } from 'typeorm';
import { RagChunk } from './entities/rag-chunk.entity';

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

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

  constructor(
    private readonly configService: ConfigService,
    private readonly entityManager: EntityManager,
  ) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      this.embeddings = null;
      return;
    }
    this.embeddings = new OpenAIEmbeddings({
      model:
        this.configService.get<string>('EMBEDDINGS_MODEL_NAME') ??
        'text-embedding-3-small',
      apiKey,
      configuration: {
        baseURL: this.configService.get<string>('OPENAI_BASE_URL'),
      },
    });
  }

  async indexSessionTurn(
    sessionId: string,
    userText: string,
    assistantText: string,
  ): Promise<void> {
    if (!this.embeddings) return;
    const rows: Partial<RagChunk>[] = [];

    const addChunks = async (role: 'user' | 'assistant', raw: string) => {
      const parts = chunkText(raw);
      for (const content of parts) {
        try {
          const vec = await this.embeddings!.embedQuery(content);
          rows.push({
            sessionId,
            role,
            content,
            embeddingJson: JSON.stringify(vec),
          });
        } catch (e) {
          this.logger.warn(`embed chunk failed: ${(e as Error).message}`);
        }
      }
    };

    await addChunks('user', userText);
    await addChunks('assistant', assistantText);

    if (!rows.length) return;
    await this.entityManager.save(
      RagChunk,
      rows.map((r) => this.entityManager.create(RagChunk, r)),
    );
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

    const chunks = await this.entityManager.find(RagChunk, {
      where: { sessionId },
      order: { createdAt: 'DESC' },
      take: 300,
    });

    if (!chunks.length) return '';
    const scored = chunks
      .map((c) => {
        try {
          const emb = JSON.parse(c.embeddingJson) as number[];
          return { c, score: cosineSimilarity(queryVec, emb) };
        } catch {
          return { c, score: -1 };
        }
      })
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    if (!scored.length) return '';
    return scored
      .map((s, i) => `[片段${i + 1} ${s.c.role}] ${s.c.content}`)
      .join('\n\n');
  }
}
