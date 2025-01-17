// openai.service.js
import OpenAI from 'openai';
import dotenv from 'dotenv';
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../../.env") });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const assistantId = 'asst_dPu2LaBEbf2EeObxrpKY7TyB';



export const getAnswerFromAssistant = async (messages, threadId = null) => {
  try {
    console.log('Starting with assistant ID:', assistantId);
    
    // Verify assistant exists
    try {
      const assistant = await openai.beta.assistants.retrieve(assistantId);
      console.log('Assistant verified:', {
        id: assistant.id,
        tools: assistant.tools,
        fileIds: assistant.file_ids,
        toolResources: assistant.tool_resources
      });
    } catch (e) {
      console.error('Failed to verify assistant:', e);
      throw new Error('Invalid assistant configuration');
    }

    // Create thread if needed
    if (!threadId) {
      console.log('Creating new thread...');
      const thread = await openai.beta.threads.create();
      threadId = thread.id;
      console.log('Thread created:', threadId);
    }

    // Add message to thread
    console.log('Adding message to thread...');
    await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: messages[messages.length - 1].content
    });

    // Create and monitor run
    console.log('Creating run...');
    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: assistantId
    });
    console.log('Run created:', run.id);

    // Poll for completion with detailed status logging
    let runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id);
    console.log('Initial run status:', runStatus.status);
    
    while (runStatus.status !== 'completed') {
      await new Promise(resolve => setTimeout(resolve, 1000));
      runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id);
      console.log('Current status:', runStatus.status);
      
      if (runStatus.status === 'failed') {
        console.error('Run failed with details:', {
          status: runStatus.status,
          lastError: runStatus.last_error,
          failureReason: runStatus.failed_at
        });
        throw new Error(`Assistant run failed: ${runStatus.last_error?.message || 'Unknown error'}`);
      }
    }

    // Get response
    console.log('Getting thread messages...');
    const threadMessages = await openai.beta.threads.messages.list(threadId);
    const lastMessage = threadMessages.data[0];

    if (!lastMessage) {
      throw new Error('No response message found');
    }

    console.log('Successfully got response');
    return {
      response: lastMessage.content[0].text.value,
      threadId: threadId
    };

  } catch (error) {
    console.error('Detailed error information:', {
      name: error.name,
      message: error.message,
      code: error.code,
      type: error.type,
      stack: error.stack
    });
    throw error;
  }
};