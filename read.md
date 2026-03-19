

prompt-test
PromptTemplate：提示词模版，可以填入占位符变量ChatPromptTemplate：对话形式（messages 数组）的提示词模版FewShotPromptTemplate：生成带示例的提示词模版FewShotChatTemplatePromptTemplate：生成带示例的提示词模版，对话形式LengthBasedExampleSelector：根据长度选择合适的示例SemanticSimilarityExampleSelector：选择语义相近的示例PipelinePromptTemplate：合并多个 Prompt Template 成一个大的 Prompt Template‘

1.ChatPromptTemplate 创建prompt模版
  const chatPrompt = ChatPromptTemplate.formMessage([['system', 'XXX'], ['human', 'XXX']])
  const chatMessage = await chatPrompt.formatMessages({})

2.MessagePlaceHolder对话记录
  new MessagePlaceHolder('history')

3.PipelinePromptTemplate, 多个 PromptTemplate组合
  指定多个 pipelinePrompts，然后指定最终的 finalPrompt
  const weeklyChatPipelinePrompt = new PipelinePromptTemplate({
    pipelinePrompts: [
        { name: 'persona_block', prompt: personaPrompt },     // 复用人设
        { name: 'context_block', prompt: contextPrompt },     // 复用背景
        { name: 'task_block', prompt: weeklyTaskPrompt },     // 本文件自己的任务模块
        { name: 'format_block', prompt: weeklyFormatPrompt }, // 本文件自己的格式模块
      ],
    // 注意：这里的 finalPrompt 是 ChatPromptTemplate，而不是普通 PromptTemplate
    finalPrompt: finalChatPrompt,
    inputVariables: [
        'tone',
        'company_name',
        'team_name',
        'manager_name',
        'week_range',
        'team_goal',
        'dev_activities',
      ],
    });

  4.FewShotPromptTemplate 加入一些示例


  OutputParsr
   依赖两种机制：tool_call、json schema
   OutputParser： 特定场景：流式打印，非 json 格式
   model.withStructuredOutput 不用区分模式 

   类似这种 OutputParser 我们也学了一些：StringOutputParser：从各种格式里取出内容，返回字符串StructuredOutputParser：按照某种 JSON 格式返回内容并解析成对象XMLOutputParser：按照 xml 格式返回内容并解析成对象JsonOutputToolsParser：解析 tool_call 的信息，支持流式

   memory 的管理策略也有三种：截断，去掉之前的一些 message总结，调用大模型对之前的 messages 生成摘要检索，基于向量数据库根据 query 检索之前聊的内容来继续聊