import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatSession } from './entities/chat-session.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { RagChunk } from './entities/rag-chunk.entity';
import { ChatHistoryService } from './chat-history.service';
import { RagService } from './rag.service';
import { VectorModule } from '../vector/vector.module';

@Module({
  imports: [TypeOrmModule.forFeature([ChatSession, ChatMessage, RagChunk]), VectorModule],
  providers: [ChatHistoryService, RagService],
  exports: [ChatHistoryService, RagService],
})
export class ChatModule {}
