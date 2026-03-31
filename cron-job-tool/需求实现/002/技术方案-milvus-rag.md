# 技术方案（Milvus 替换 MySQL 向量检索）— 会话级 RAG

## 0. 目标与约束

- **目标**：将当前 `cron-job-tool` 中 RAG 的在线检索从「MySQL 拉取 embeddingJson + Node 计算余弦」替换为 **Milvus ANN 检索**，解决会话量/轮数大时的卡慢问题。
- **检索范围**：**仅当前 `sessionId`**。
- **删除策略**：支持 **删除会话时同步删除 Milvus 向量**（会话删除后不应再命中该会话向量）。
- **Embedding**：使用 `text-embedding-v3`，并参考 `milvus-test/src/ebook-writer.mjs` 的 Milvus SDK 用法（`@zilliz/milvus2-sdk-node`）。
- **部署**：Milvus 本地 Docker（单机）。
- **不包含**：具体代码实现细节（本文件提供“改什么、怎么接、按什么顺序调用”的落地方案）。

---

## 1. 现状问题（为什么要换）

当前 `src/chat/rag.service.ts` 的 `retrieveContext()` 逻辑是：

1. MySQL 按 `sessionId` 拉取最近 N 条 `RagChunk`（如 `take: 300`）
2. Node 逐条 `JSON.parse(embeddingJson)` 并计算余弦相似度
3. 排序取 Top-K

当 **会话轮数大 + 并发提升** 时，会出现：

- MySQL IO 与网络传输压力增大（大量 embeddingJson 出库）
- Node CPU 压力增大（解析 + 计算 + 排序）
- 延迟抖动明显，导致整体对话卡慢

---

## 2. 目标架构（推荐）

采用 **MySQL 存权威历史 + Milvus 存向量**：

- **MySQL**：`ChatSession` / `ChatMessage` 作为权威数据源；（可选）`RagChunk` 仅存元数据（审计/回放/迁移）
- **Milvus**：存 `{embedding vector + sessionId + role + content}`，负责相似度检索

检索链路：

1. 用户提问 -> 生成 query embedding
2. Milvus `search`（过滤 `session_id == sessionId`）-> Top-K `content`
3. 组装成“历史片段上下文块”注入系统提示

写入链路：

1. 一轮对话落库后 -> 将 user/assistant 文本切片 -> 生成 embedding
2. Milvus `insert`（批量）写入向量

删除链路：

1. 删除会话（MySQL）-> 同步执行 Milvus 按 `session_id` 删除向量

---

## 3. Milvus 设计（参照 `ebook-writer.mjs`）

### 3.1 环境变量（`cron-job-tool/.env`）

建议新增：

- `MILVUS_ADDRESS=localhost:19530`
- `MILVUS_COLLECTION=rag_chunks`
- `VECTOR_DIM=1024`
- `EMBEDDINGS_MODEL_NAME=text-embedding-v3`

> `VECTOR_DIM` 必须与 `OpenAIEmbeddings({ dimensions })` 一致。

### 3.2 Collection Schema（`rag_chunks`）

字段建议（对齐你示例风格）：

- `id`: VarChar，主键（手动生成）
- `session_id`: VarChar（过滤/删除关键字段）
- `role`: VarChar（`user`/`assistant`）
- `index`: Int32（chunk 序号，调试与排序用）
- `content`: VarChar（建议 `max_length: 10000`）
- `vector`: FloatVector（`dim: VECTOR_DIM`）

### 3.3 Index

按示例创建：

- `field_name: vector`
- `index_type: IVF_FLAT`
- `metric_type: COSINE`
- `params: { nlist: 1024 }`

并在启动或首次使用时：

- `hasCollection` -> `createCollection`（若不存在）
- `createIndex`
- `loadCollection`

---

## 4. 后端改造点（按文件/模块划分）

### 4.1 新增文件与职责

建议新增一个向量存储服务（命名可调整）：

1. `src/vector/milvus.service.ts`
  - 初始化 `MilvusClient({ address: MILVUS_ADDRESS })`
  - `ensureCollection()`：参考 `ebook-writer.mjs` 的创建/索引/加载顺序
  - `insertRagChunks(records[])`：批量 insert
  - `searchBySession(sessionId, queryVector, topK)`：带过滤搜索
  - `deleteBySessionId(sessionId)`：按过滤表达式删除
2. `src/vector/vector.module.ts`（可选）
  - 将 MilvusService 注册为 provider，供 `ChatModule/RagService` 注入

### 4.2 修改现有文件

1. `src/chat/rag.service.ts`
  - **读取路径替换**：`retrieveContext()` 从 MySQL+JS 计算 -> Milvus `search`
  - **写入路径替换**：`indexSessionTurn()` 增加 Milvus `insert`（可保留 MySQL 元数据写入）
  - **降级策略**（强烈建议）：Milvus 连接失败时返回空上下文或回退 MySQL（避免对话完全不可用）
2. `src/chat/chat-history.service.ts`
  - 不需要改调用方语义：仍在 `appendExchange()` 末尾调用 `ragService.indexSessionTurn()`
  - 仅需确保索引失败不会影响主链路（记录日志即可）
3. `src/ai/ai.service.ts`
  - 不需要改外部接口：仍在每轮提问前调用 `ragService.retrieveContext(sessionId, query)`
4. `src/app.module.ts` / `src/chat/chat.module.ts`
  - 引入 `VectorModule` 或直接把 `MilvusService` 注册到 `ChatModule` 的 providers

---

## 5. 关键调用顺序（严格对齐 `ebook-writer.mjs`）

### 5.1 服务启动/首次使用（Milvus）

1. `client = new MilvusClient({ address })`
2. `await client.connectPromise`
3. `hasCollection({ collection_name })`
4. 若不存在：`createCollection({ fields: [...] })`
5. `createIndex({ collection_name, field_name: 'vector', index_type, metric_type, params })`
6. `loadCollection({ collection_name })`

### 5.2 写入（index）

1. 文本切片（建议 `chunkSize=500`，可选 `overlap=50`）
2. `OpenAIEmbeddings.embedQuery(text)` 生成 `vector`（长度=1024）
3. 构造 insertData：
  - `id`: `${sessionId}_${timestamp}_${role}_${chunkIndex}`
  - `session_id`: sessionId
  - `role`: user/assistant
  - `index`: chunkIndex
  - `content`: chunkText
  - `vector`: float[]
4. `client.insert({ collection_name, data: insertData })`

### 5.3 检索（retrieve）

1. `queryVec = embeddings.embedQuery(query)`
2. `client.search({ ... })`
  - `collection_name`
  - `vector`: queryVec（字段名以 SDK 要求为准，核心是对 `vector` 字段搜索）
  - `filter/expr`: `session_id == \"${sessionId}\"`
  - `limit/topK`: 4~8
  - `output_fields`: `['content','role','index']`
3. 取 Top-K 结果拼接：
  - `[片段1 role] content`

> 重点：过滤一定要落在 Milvus 侧，避免“全库检索后再过滤”。

### 5.4 删除（delete session）

新增后端接口语义：

- `DELETE /ai/sessions/:id`

时序建议：

1. MySQL：删除 `ChatSession`（级联删除 `ChatMessage`，以及可选 `RagChunk` 元数据）
2. Milvus：`deleteBySessionId(sessionId)`（expr：`session_id == \"...\"`）
3. 返回成功

失败策略建议：

- MySQL 成功但 Milvus 失败：返回 500，并记录错误 + 重试告警（避免向量残留导致未来误命中）

---

## 6. 数据模型调整建议（MySQL）

### 6.1 `RagChunk` 是否保留

推荐保留 `RagChunk` 作为“可观测元数据”，但在线检索不依赖 MySQL：

- 保留：`sessionId/role/content/createdAt`
- `embeddingJson`：
  - 迁移期可继续写入（用于回退/对照）
  - 稳定后可停止写入，甚至改为可空/移除

---

## 7. 迁移/切换步骤（建议）

1. 本地 Docker 启动 Milvus，验证连接与建 collection
2. 实现 Milvus `ensureCollection + insert + search` 的最小链路（可用单元脚本验证）
3. **双写阶段**：`indexSessionTurn()` 同时写 MySQL（可选）+ Milvus；`retrieveContext()` 仍走旧逻辑
4. **切读阶段**：`retrieveContext()` 切 Milvus search（保留降级/回退）
5. 上线 `DELETE /ai/sessions/:id`：同时删 MySQL + Milvus
6. 稳定后：停止写 `embeddingJson`（或保留但不读取）

---

## 8. 性能与稳定性建议（会话轮数可能很大）

- **异步化索引**：回复先返回，embedding+insert 后台执行（避免写入阻塞对话）
- **批量 insert**：同一轮多个 chunk 一次性 insert，减少网络往返
- **限流与配额**：避免大量并发写入导致 embedding API 或 Milvus 压力骤增
- **观测指标**：
  - embedding 耗时、Milvus insert/search 耗时
  - RAG 命中率（topK 结果数 > 0）
  - delete 成功率（MySQL/Milvus）

---

## 9. 与当前接口/页面的对应关系

现有对话接口（前端 `public/index.html` 使用）：  

- `GET /ai/chat/stream?query=...&sessionId=...`（SSE）

建议补齐删除会话功能以闭环：  

- `DELETE /ai/sessions/:id`（前端会话列表提供删除入口 + 二次确认）

---

## 10. 附：你参考文件对应点

`milvus-test/src/ebook-writer.mjs` 中可直接复用的模式：

- `MilvusClient({ address: 'localhost:19530' })`
- `ensureCollection()`：`hasCollection -> createCollection -> createIndex -> loadCollection`
- `createIndex`: `IndexType.IVF_FLAT` + `MetricType.COSINE` + `{ nlist: 1024 }`
- embedding：`OpenAIEmbeddings({ model, dimensions: VECTOR_DIM })`

