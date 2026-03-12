基于 LangChain 的 AI 应用示例与实验仓库，涵盖向量检索、会话记忆、工具调用、RAG 等能力。

---

## 核心能力


| 能力                  | 所在子项目                                                              | 说明                                                                         |
| ------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| **基于 Milvus 的向量检索** | `runnable-test`、`prompt-template-test`、`milvus-test`、`memory-test` | 使用 `@zilliz/milvus2-sdk-node` 进行 RAG 检索、Few-shot 示例语义选择                    |
| **历史会话记忆**          | `runnable-test`、`tool-test`、`memory-test`                          | `InMemoryChatMessageHistory`、`RunnableWithMessageHistory`、Retrieval Memory |
| **数据库查询工具调用**       | `output-parser-test`                                               | 可扩展的 MySQL 连接与查询工具                                                         |
| **MCP 工具调用**        | `tool-test`、`runnable-test`                                        | 高德地图、文件系统、Chrome DevTools 等 MCP 服务                                         |
| **Agent 工具调用**      | `tool-test`                                                        | `read_file`、`write_file`、`execute_command`、`list_directory`                |
| **Prompt 模板**       | `prompt-template-test`                                             | ChatPromptTemplate、FewShot、Pipeline、Milvus 语义示例选择                          |
| **输出解析**            | `output-parser-test`                                               | JSON/XML/结构化输出、流式 Tool Calls 解析                                            |


### 子项目一览

```

├── runnable-test/        # Runnable、RAG、会话记忆、MCP
├── tool-test/            # Agent 工具调用、MCP、React TodoList 示例
├── prompt-template-test/ # 提示词模板、Milvus Few-shot
├── output-parser-test/   # 输出解析、数据库工具
├── memory-test/          # 会话记忆、Retrieval Memory
├── milvus-test/          # Milvus CRUD、RAG 示例
├── rag-test/             # RAG 相关
├── milvus/               # Milvus Docker 部署
└── tool-test/react-todo-app/  # React TodoList 前端
```

---

## 如何运行 (How to Run)

### 前置要求

- **Node.js**：v18+ 或 v20+
- **pnpm**：`npm install -g pnpm`
- **Docker**：使用 Milvus 时需安装

### 1. 环境变量

在项目根目录或各子项目目录创建 `.env` 文件：

```env
# OpenAI 兼容 API（必填，用于 LLM 与 Embedding）
OPENAI_API_KEY=sk-your-api-key
OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1

# 模型配置（可选）
MODEL_NAME=qwen3.5-plus
EMBEDDINGS_MODEL_NAME=text-embedding-3-small

# Milvus（可选，默认 localhost:19530）
MILVUS_ADDRESS=localhost:19530
MILVUS_COLLECTION_NAME=your_collection

# 高德地图 MCP（可选，tool-test / runnable-test 使用）
AMAP_MAPS_API_KEY=your-amap-key
```


| 变量                      | 必填  | 说明                             |
| ----------------------- | --- | ------------------------------ |
| `OPENAI_API_KEY`        | ✅   | OpenAI 兼容 API Key              |
| `OPENAI_BASE_URL`       | 推荐  | API 基础 URL                     |
| `MODEL_NAME`            | 可选  | 对话模型名称                         |
| `EMBEDDINGS_MODEL_NAME` | 可选  | Embedding 模型（RAG/Milvus 使用）    |
| `MILVUS_ADDRESS`        | 可选  | Milvus 地址，默认 `localhost:19530` |
| `AMAP_MAPS_API_KEY`     | 可选  | 高德地图 MCP 所需                    |


### 2. 安装依赖

各子项目独立安装：

```bash
# 示例：tool-test
cd tool-test && pnpm install

# 示例：runnable-test
cd runnable-test && pnpm install

# 示例：React TodoList 前端
cd tool-test/react-todo-app && pnpm install
```

### 3. 启动 Node.js 服务

各子项目为脚本驱动，直接运行对应入口：

```bash
# tool-test：MCP Agent
cd tool-test
node src/mcp-test.mjs

# runnable-test：RAG 示例（需先启动 Milvus）
cd runnable-test
node src/cases/ebook-reader-rag.mjs

# React TodoList 前端（Vite 开发服务器）
cd tool-test/react-todo-app
pnpm run dev
# 访问 http://localhost:5173
```

### 4. 连接 Milvus

使用 Milvus 的子项目需先启动 Milvus 服务：

```bash
cd milvus
docker compose -f milvus-standalone-docker-compose.yml up -d
```

- **默认地址**：`localhost:19530`
- **环境变量**：`MILVUS_ADDRESS=localhost:19530`（可选）

验证连接：

```bash
# 示例：运行 milvus-test 中的查询
cd milvus-test && node src/query.mjs
```

---

## 代码规范与工程化


| 项目      | 说明                                                      |
| ------- | ------------------------------------------------------- |
| **包管理** | pnpm，各子项目独立 `package.json`                              |
| **模块**  | ES Modules（`.mjs`）或 `"type": "module"`                  |
| **配置**  | `dotenv` 加载 `.env`，敏感信息不提交                              |
| **忽略**  | `.gitignore` 排除 `node_modules`、`.env`、`milvus/volumes/` |


### 推荐实践

- 在各子项目根目录配置 `.env`
- 使用 `OPENAI_API_KEY` 等环境变量，避免硬编码
- Milvus 使用 `MILVUS_ADDRESS` 便于切换环境

---

