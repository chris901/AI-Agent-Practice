import { Inject, Injectable } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import {
  AIMessage,
  AIMessageChunk,
  BaseMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import { Runnable } from '@langchain/core/runnables';
import { ChatHistoryService } from '../chat/chat-history.service';
import { RagService } from '../chat/rag.service';

@Injectable()
export class AiService {
  private readonly modelWithTools: Runnable<BaseMessage[], AIMessage>;

  constructor(
    @Inject('CHAT_MODEL') model: ChatOpenAI,
    @Inject('SEND_MAIL_TOOL') private readonly sendMailTool: any,
    @Inject('QUERY_USER_TOOL') private readonly queryUserTool: any,
    @Inject('WEB_SEARCH_TOOL') private readonly webSearchTool: any,
    @Inject('DB_USERS_CRUD_TOOL') private readonly dbUsersCrudTool: any,
    @Inject('CRON_JOB_TOOL') private readonly cronJobTool: any,
    @Inject('TIME_NOW_TOOL') private readonly timeNowTool: any,
    private readonly chatHistory: ChatHistoryService,
    private readonly ragService: RagService,
  ) {
    this.modelWithTools = model.bindTools([
      this.queryUserTool,
      this.sendMailTool,
      this.webSearchTool,
      this.dbUsersCrudTool,
      this.cronJobTool,
      this.timeNowTool,
    ]);
  }

  private isTimeQuestion(query: string): boolean {
    const q = query.trim();
    // 只覆盖“当前时间/今天日期/现在几点/现在几点几分”常见表达
    return (
      q.includes('时间') ||
      q.includes('几点') ||
      q.includes('日期') ||
      q.includes('今天') ||
      /\b(current time|current date|time now|date)\b/i.test(q)
    );
  }

  private formatTimeNowFromToolResult(result: unknown): string {
    const r = result as
      | { iso?: string; timestamp?: number; localText?: string }
      | null
      | undefined;

    // 优先使用 time_now 工具返回的本地时区文本，避免 UTC 与本地时区偏差
    if (r?.localText && typeof r.localText === 'string') {
      return `当前时间是 ${r.localText}`;
    }

    const iso = r?.iso;
    const ts = r?.timestamp;
    const d =
      iso != null
        ? new Date(iso)
        : typeof ts === 'number'
          ? new Date(ts)
          : null;

    if (!d || Number.isNaN(d.getTime())) {
      return '当前时间：无法解析 time_now 返回值';
    }

    const pad2 = (n: number) => String(n).padStart(2, '0');
    const yyyy = d.getFullYear();
    const mm = d.getMonth() + 1;
    const dd = d.getDate();
    const hh = d.getHours();
    const mi = d.getMinutes();
    const ss = d.getSeconds();
    return `当前时间是 ${yyyy}年${mm}月${dd}日 ${pad2(hh)}:${pad2(mi)}:${pad2(
      ss,
    )}`;
  }

  private async ragBlockFor(sessionId: string, query: string): Promise<string> {
    const ctx = await this.ragService.retrieveContext(sessionId, query);
    if (!ctx) return '';
    return `\n\n以下是与当前问题相关的历史片段，请仅作为参考，不要编造不存在的信息：\n${ctx}`;
  }

  async runChain(
    query: string,
    sessionId?: string,
  ): Promise<{ answer: string; sessionId: string }> {
    const sid = sessionId ?? (await this.chatHistory.createSession()).id;

    // 时间类问题使用 time_now 做确定性输出，避免模型“猜测日期”
    if (this.isTimeQuestion(query)) {
      const toolResult = await this.timeNowTool.invoke({});
      const answer = this.formatTimeNowFromToolResult(toolResult);
      await this.chatHistory.appendExchange(sid, query, answer);
      return { answer, sessionId: sid };
    }

    const ragBlock = await this.ragBlockFor(sid, query);
    const messages: BaseMessage[] = [
      new SystemMessage(
        `你是一个智能助手，可以在需要时调用工具（如 query_user）来查询用户信息，（send_mail）发送邮件，再用结果回答用户的问题。${ragBlock}`,
      ),
      new HumanMessage(query),
    ];

    while (true) {
      const aiMessage = await this.modelWithTools.invoke(messages);
      messages.push(aiMessage);

      const toolCalls = aiMessage.tool_calls ?? [];

      if (!toolCalls.length) {
        const answer = String(aiMessage.content ?? '');
        await this.chatHistory.appendExchange(sid, query, answer);
        return { answer, sessionId: sid };
      }

      for (const toolCall of toolCalls) {
        const toolCallId = toolCall.id || '';
        const toolName = toolCall.name;

        if (toolName === 'query_user') {
          const result = await this.queryUserTool.invoke(toolCall.args);

          messages.push(
            new ToolMessage({
              tool_call_id: toolCallId,
              name: toolName,
              content: result,
            }),
          );
        } else if (toolName === 'send_mail') {
          const result = await this.sendMailTool.invoke(toolCall.args);

          messages.push(
            new ToolMessage({
              tool_call_id: toolCallId,
              name: toolName,
              content: result,
            }),
          );
        } else if (toolName === 'web_search') {
          const result = await this.webSearchTool.invoke(toolCall.args);

          messages.push(
            new ToolMessage({
              tool_call_id: toolCallId,
              name: toolName,
              content: result,
            }),
          );
        } else if (toolName === 'db_users_crud') {
          const result = await this.dbUsersCrudTool.invoke(toolCall.args);

          messages.push(
            new ToolMessage({
              tool_call_id: toolCallId,
              name: toolName,
              content: result,
            }),
          );
        } else if (toolName === 'cron_job') {
          const result = await this.cronJobTool.invoke(toolCall.args);

          messages.push(
            new ToolMessage({
              tool_call_id: toolCallId,
              name: toolName,
              content: result,
            }),
          );
        } else if (toolName === 'time_now') {
          const result = await this.timeNowTool.invoke(toolCall.args);
          const content =
            typeof result === 'string' ? result : JSON.stringify(result);

          messages.push(
            new ToolMessage({
              tool_call_id: toolCallId,
              name: toolName,
              content,
            }),
          );
        }
      }
    }
  }

  async *runChainStream(
    query: string,
    sessionId: string,
  ): AsyncIterable<string> {
    // 时间类问题使用 time_now 做确定性输出，避免模型“猜测日期”或 time_now 对象导致的消息解析问题
    if (this.isTimeQuestion(query)) {
      const toolResult = await this.timeNowTool.invoke({});
      const answer = this.formatTimeNowFromToolResult(toolResult);
      await this.chatHistory.appendExchange(sessionId, query, answer);
      yield answer;
      return;
    }

    const ragBlock = await this.ragBlockFor(sessionId, query);
    const messages: BaseMessage[] = [
      new SystemMessage(`你是一个通用任务助手，可以根据用户的目标规划步骤，并在需要时调用工具：\`time_now\`获取当前服务器时间，\`query_user\` 查询或校验用户信息、\`send_mail\` 发送邮件、\`web_search\` 进行互联网搜索、\`db_users_crud\` 读写数据库 users 表、\`cron_job\` 创建和管理定时/周期任务（\`list\`/\`add\`/\`toggle\`），从而实现提醒、定期任务、数据同步等各种自动化需求。
        
        定时任务类型选择规则（非常重要）：
        - 用户说“X分钟/小时/天后”“在某个时间点”“到点提醒”（一次性）=> 用 \`cron_job\` + \`type=at\`（执行一次后自动停用），\`at\`=当前时间+X 或解析出的时间点
        - 用户说“每X分钟/每小时/每天”“定期/循环/一直”（重复执行）=> 用 \`cron_job\` + \`type=every\`（每次执行），\`everyMs\`=X换算成毫秒
        - 用户给出 Cron 表达式或明确说“用 cron 表达式”（重复执行）=> 用 \`cron_job\` + \`type=cron\`
        
        在调用 \`cron_job.add\` 创建任务时，需要把用户原始自然语言拆成两部分：一部分是“什么时候执行”（用来决定 type/at/everyMs/cron），另一部分是“要做什么任务本身”。\`instruction\` 字段只能填“要做什么”的那部分文本（保持原语言和原话），不能再改写、翻译或总结。
        
        当用户请求“在未来某个时间点执行某个动作”（例如“1分钟后给我发一个笑话到邮箱”）时，本轮对话只需要使用 \`cron_job\` 设置/更新定时任务，不要在当前轮直接完成这个动作本身：不要直接调用 \`send_mail\` 给他发邮件，也不要在当前轮就真正“执行”指令，只需把要执行的动作写进 \`instruction\` 里，交给将来的定时任务去跑。
        
        注意：像“\`1分钟后提醒我喝水\`”，时间相关信息用于计算下一次执行时间，而 \`instruction\` 应该是“提醒我喝水”；本轮不需要立刻提醒。${ragBlock}`),
      new HumanMessage(query),
    ];
    let accumulated = '';

    while (true) {
      const stream = await this.modelWithTools.stream(messages);

      let fullAIMessage: AIMessageChunk | null = null;

      for await (const chunk of stream as AsyncIterable<AIMessageChunk>) {
        fullAIMessage = fullAIMessage ? fullAIMessage.concat(chunk) : chunk;

        const hasToolCallChunk =
          !!fullAIMessage.tool_call_chunks &&
          fullAIMessage.tool_call_chunks.length > 0;

        if (!hasToolCallChunk && chunk.content) {
          const txt = String(chunk.content);
          accumulated += txt;
          yield txt;
        }
      }

      if (!fullAIMessage) {
        return;
      }

      messages.push(fullAIMessage);

      const toolCalls = fullAIMessage.tool_calls ?? [];

      if (!toolCalls.length) {
        await this.chatHistory.appendExchange(sessionId, query, accumulated);
        return;
      }

      for (const toolCall of toolCalls) {
        const toolCallId = toolCall.id || '';
        const toolName = toolCall.name;

        if (toolName === 'query_user') {
          const result = await this.queryUserTool.invoke(toolCall.args);

          messages.push(
            new ToolMessage({
              tool_call_id: toolCallId,
              name: toolName,
              content: result,
            }),
          );
        } else if (toolName === 'send_mail') {
          const result = await this.sendMailTool.invoke(toolCall.args);

          messages.push(
            new ToolMessage({
              tool_call_id: toolCallId,
              name: toolName,
              content: result,
            }),
          );
        } else if (toolName === 'web_search') {
          const result = await this.webSearchTool.invoke(toolCall.args);

          messages.push(
            new ToolMessage({
              tool_call_id: toolCallId,
              name: toolName,
              content: result,
            }),
          );
        } else if (toolName === 'db_users_crud') {
          const result = await this.dbUsersCrudTool.invoke(toolCall.args);

          messages.push(
            new ToolMessage({
              tool_call_id: toolCallId,
              name: toolName,
              content: result,
            }),
          );
        } else if (toolName === 'cron_job') {
          const result = await this.cronJobTool.invoke(toolCall.args);

          messages.push(
            new ToolMessage({
              tool_call_id: toolCallId,
              name: toolName,
              content: result,
            }),
          );
        } else if (toolName === 'time_now') {
          const result = await this.timeNowTool.invoke(toolCall.args);
          const content =
            typeof result === 'string' ? result : JSON.stringify(result);

          messages.push(
            new ToolMessage({
              tool_call_id: toolCallId,
              name: toolName,
              content,
            }),
          );
        }
      }
    }
  }
}
