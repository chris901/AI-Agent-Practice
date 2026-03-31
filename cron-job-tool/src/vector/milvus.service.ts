import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DataType,
  IndexType,
  MetricType,
  MilvusClient,
} from '@zilliz/milvus2-sdk-node';

type RagInsertRow = {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  index: number;
  content: string;
  vector: number[];
};

type RagSearchHit = {
  score?: number;
  content?: string;
  role?: string;
  index?: number;
};

@Injectable()
export class MilvusService {
  private readonly logger = new Logger(MilvusService.name);
  private readonly client: MilvusClient;
  private readonly collectionName: string;
  private readonly vectorDim: number;
  private ensurePromise: Promise<void> | null = null;

  constructor(private readonly configService: ConfigService) {
    this.collectionName =
      this.configService.get<string>('MILVUS_COLLECTION') ?? 'rag_chunks';
    const addr =
      this.configService.get<string>('MILVUS_ADDRESS') ?? 'localhost:19530';
    const dimStr = this.configService.get<string>('VECTOR_DIM') ?? '1024';
    this.vectorDim = Number(dimStr);
    this.client = new MilvusClient({ address: addr });
  }

  private async ensureCollection(): Promise<void> {
    if (this.ensurePromise) return this.ensurePromise;
    this.ensurePromise = (async () => {
      await this.client.connectPromise;

      const has = await this.client.hasCollection({
        collection_name: this.collectionName,
      });

      if (!has.value) {
        this.logger.log(`create milvus collection: ${this.collectionName}`);
        await this.client.createCollection({
          collection_name: this.collectionName,
          fields: [
            {
              name: 'id',
              data_type: DataType.VarChar,
              max_length: 128,
              is_primary_key: true,
            },
            {
              name: 'session_id',
              data_type: DataType.VarChar,
              max_length: 64,
            },
            {
              name: 'role',
              data_type: DataType.VarChar,
              max_length: 16,
            },
            { name: 'index', data_type: DataType.Int32 },
            {
              name: 'content',
              data_type: DataType.VarChar,
              max_length: 10000,
            },
            {
              name: 'vector',
              data_type: DataType.FloatVector,
              dim: this.vectorDim,
            },
          ],
        });

        await this.client.createIndex({
          collection_name: this.collectionName,
          field_name: 'vector',
          index_type: IndexType.IVF_FLAT,
          metric_type: MetricType.COSINE,
          params: { nlist: 1024 },
        });
      }

      try {
        await this.client.loadCollection({ collection_name: this.collectionName });
      } catch {
        // ignore: already loaded
      }
    })();
    return this.ensurePromise;
  }

  get enabled(): boolean {
    return !!this.configService.get<string>('MILVUS_ADDRESS');
  }

  async insertRagChunks(rows: RagInsertRow[]): Promise<number> {
    if (!this.enabled) return 0;
    await this.ensureCollection();
    if (!rows.length) return 0;
    const res = await this.client.insert({
      collection_name: this.collectionName,
      data: rows,
    });
    return Number(res.insert_cnt) || 0;
  }

  async searchBySessionId(
    sessionId: string,
    queryVector: number[],
    topK: number,
  ): Promise<RagSearchHit[]> {
    if (!this.enabled) return [];
    await this.ensureCollection();

    const expr = `session_id == "${sessionId}"`;

    const res: any = await (this.client as any).search({
      collection_name: this.collectionName,
      vector: queryVector,
      // SDK 不同版本字段可能不同，保留 params/search_params 兼容
      limit: topK,
      expr,
      output_fields: ['content', 'role', 'index'],
      metric_type: MetricType.COSINE,
      params: { nprobe: 16 },
    });

    const data: any[] = res?.results ?? res?.data ?? res ?? [];
    return (Array.isArray(data) ? data : []).map((hit) => ({
      score: hit.score ?? hit.distance,
      content: hit.content ?? hit?.entity?.content,
      role: hit.role ?? hit?.entity?.role,
      index: hit.index ?? hit?.entity?.index,
    }));
  }

  async deleteBySessionId(sessionId: string): Promise<void> {
    if (!this.enabled) return;
    await this.ensureCollection();
    const expr = `session_id == "${sessionId}"`;
    await this.client.deleteEntities({
      collection_name: this.collectionName,
      expr,
    } as any);
  }
}

