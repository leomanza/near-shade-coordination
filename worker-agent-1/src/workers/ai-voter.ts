import { OpenAI } from 'openai';
import type { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions';
import type { VoteResult } from '../../../shared/src/types';

/**
 * AI voter module — calls NEAR AI API to vote on proposals based on manifesto alignment.
 * Pattern from verifiable-ai-dao/src/ai.ts
 */

const SYSTEM_MESSAGE =
  'You are a Decentralized Autonomous Organization (DAO) agent. ' +
  'You are responsible for making decisions on behalf of the DAO. ' +
  'Each prompt will contain the manifesto you use to vote and a proposal that you will vote on. ' +
  'You will vote on the proposal based on the manifesto. ' +
  'You will provide both your vote (Approved or Rejected) and a clear explanation of your reasoning ' +
  'based on how the proposal aligns with the manifesto. You must keep responses under 10,000 characters.';

export async function aiVote(manifesto: string, proposal: string): Promise<VoteResult> {
  const apiKey = process.env.NEAR_AI_API_KEY || process.env.NEAR_API_KEY;
  if (!apiKey) {
    throw new Error('NEAR_AI_API_KEY or NEAR_API_KEY environment variable is not set');
  }

  const openai = new OpenAI({
    baseURL: 'https://cloud-api.near.ai/v1',
    apiKey,
  });

  const userMessage = `Manifesto: ${manifesto}\nProposal: ${proposal}`;

  const request: ChatCompletionCreateParamsNonStreaming = {
    model: 'deepseek-ai/DeepSeek-V3.1',
    tools: [
      {
        type: 'function',
        function: {
          name: 'dao_vote',
          description: 'Vote on a DAO proposal with reasoning',
          parameters: {
            type: 'object',
            properties: {
              vote: { type: 'string', enum: ['Approved', 'Rejected'] },
              reasoning: {
                type: 'string',
                description: 'Explanation for the voting decision based on the manifesto',
              },
            },
            required: ['vote', 'reasoning'],
          },
        },
      },
    ],
    tool_choice: { type: 'function', function: { name: 'dao_vote' } },
    messages: [
      { role: 'system', content: SYSTEM_MESSAGE },
      { role: 'user', content: userMessage },
    ],
  };

  const completion = await openai.chat.completions.create(request);

  const toolCall = completion.choices[0]?.message?.tool_calls?.[0];
  if (!toolCall || toolCall.type !== 'function') {
    throw new Error('Expected function tool call response from AI');
  }

  const rawResponse = JSON.parse(toolCall.function.arguments);

  if (rawResponse.vote !== 'Approved' && rawResponse.vote !== 'Rejected') {
    throw new Error(`Invalid vote: "${rawResponse.vote}". Must be "Approved" or "Rejected"`);
  }

  if (rawResponse.reasoning.length > 10000) {
    throw new Error(`AI reasoning too long: ${rawResponse.reasoning.length} chars`);
  }

  return {
    vote: rawResponse.vote,
    reasoning: rawResponse.reasoning,
  };
}
