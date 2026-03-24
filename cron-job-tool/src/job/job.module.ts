import { Module, forwardRef } from '@nestjs/common';
import { JobService } from './job.service';
import { ToolModule } from '../tool/tool.module';
import { JobAgentService } from '../ai/job-agent.service';

@Module({
  imports: [forwardRef(() => ToolModule)],
  providers: [JobService, JobAgentService],
  exports: [JobService],
})
export class JobModule {}
