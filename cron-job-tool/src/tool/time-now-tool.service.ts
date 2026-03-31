import { Injectable } from '@nestjs/common';
import { tool } from '@langchain/core/tools';

@Injectable()
export class TimeNowToolService {
  readonly tool;

  constructor() {
    this.tool = tool(
      async () => {
        const now = new Date();
        // ISO 字符串是 UTC 时间（以 Z 结尾），容易和本地时间差 8 小时
        // 这里额外返回按服务器本地时区格式化的时间字符串，方便直接回答给用户
        const pad2 = (n: number) => String(n).padStart(2, '0');
        const yyyy = now.getFullYear();
        const mm = now.getMonth() + 1;
        const dd = now.getDate();
        const hh = now.getHours();
        const mi = now.getMinutes();
        const ss = now.getSeconds();

        return {
          iso: now.toISOString(), // UTC 时间，机器可读
          timestamp: now.getTime(), // 毫秒级时间戳
          localText: `${yyyy}年${mm}月${dd}日 ${pad2(hh)}:${pad2(
            mi,
          )}:${pad2(ss)}`, // 服务器本地时区的人类可读时间，例如北京时区就是北京时间
        };
      },
      {
        name: 'time_now',
        description:
          '获取当前服务器时间。字段含义：\n- iso：UTC 时间的 ISO 字符串（以 Z 结尾）\n- timestamp：毫秒级时间戳\n- localText：按服务器本地时区格式化的人类可读时间（例如北京时间环境下就是当前北京时间，如“2026年3月31日 16:40:00”）。\n\n当需要直接回答“现在几点/当前时间/今天日期”给用户时，应优先使用 localText 字段，不要直接复述 iso 里的 UTC 时间，以免出现 8 小时误差。',
      },
    );
  }
}
