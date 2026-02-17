import { OpenAI } from 'openai';
import type { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions';
import type { VoteResult, VerificationProof, ModelAttestation } from '@near-shade-coordination/shared';
import { randomBytes } from 'crypto';

/**
 * AI voter module — calls NEAR AI API to vote on proposals based on manifesto alignment.
 * Pattern from verifiable-ai-dao/src/ai.ts
 */

const SYSTEM_MESSAGE =
  'You are a Decentralized Autonomous Organization (DAO) agent with a persistent identity. ' +
  'You have your own values, accumulated knowledge, and decision history that shape your reasoning. ' +
  'Each prompt will contain your agent identity (values, guidelines, voting weights, past decisions), ' +
  'the DAO manifesto, and a proposal to vote on. ' +
  'Vote on the proposal based on BOTH the DAO manifesto AND your personal agent identity. ' +
  'Your accumulated knowledge and past decisions should inform your reasoning. ' +
  'Provide both your vote (Approved or Rejected) and a clear explanation of your reasoning. ' +
  'You must keep responses under 10,000 characters.';

export interface AiVoteResult extends VoteResult {
  verificationProof?: VerificationProof;
}

export async function aiVote(manifesto: string, proposal: string, agentContext?: string): Promise<AiVoteResult> {
  const apiKey = process.env.NEAR_AI_API_KEY || process.env.NEAR_API_KEY;
  if (!apiKey) {
    throw new Error('NEAR_AI_API_KEY or NEAR_API_KEY environment variable is not set');
  }

  const openai = new OpenAI({
    baseURL: 'https://cloud-api.near.ai/v1',
    apiKey,
  });

  let userMessage = '';
  if (agentContext) {
    userMessage += `${agentContext}\n\n`;
  }
  userMessage += `=== DAO MANIFESTO ===\n${manifesto}\n\n=== PROPOSAL ===\n${proposal}`;

  const model = 'deepseek-ai/DeepSeek-V3.1';

  const request: ChatCompletionCreateParamsNonStreaming = {
    model,
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

  // Fetch NEAR AI verification proof (non-blocking — vote still valid without it)
  let verificationProof: VerificationProof | undefined;
  const chatId = completion.id;
  if (chatId) {
    try {
      verificationProof = await fetchVerificationProof(chatId, model, apiKey);

      // Fetch model attestation to link signing_address to TEE hardware
      if (verificationProof) {
        try {
          const attestation = await fetchModelAttestation(model, apiKey);
          verificationProof.attestation = attestation;
        } catch (e) {
          console.warn('[ai-voter] Failed to fetch model attestation (non-critical):', e);
        }
      }
    } catch (e) {
      console.warn('[ai-voter] Failed to fetch verification proof (non-critical):', e);
    }
  }

  return {
    vote: rawResponse.vote,
    reasoning: rawResponse.reasoning,
    verificationProof,
  };
}

/**
 * Fetch NEAR AI model verification proof for a chat completion.
 * See: https://docs.near.ai/cloud/verification/chat
 *
 * The proof contains:
 * - text: "request_hash:response_hash" signed by the TEE running the model
 * - signature: ECDSA signature verifiable with ethers.verifyMessage()
 * - signing_address: TEE public key unique to the model
 *
 * This proves which model was used WITHOUT exposing the actual content.
 */
async function fetchVerificationProof(
  chatId: string,
  model: string,
  apiKey: string,
): Promise<VerificationProof> {
  const url = `https://cloud-api.near.ai/v1/signature/${encodeURIComponent(chatId)}?model=${encodeURIComponent(model)}&signing_algo=ecdsa`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    throw new Error(`Signature API returned ${res.status}: ${await res.text()}`);
  }

  const sig = await res.json() as {
    text: string;
    signature: string;
    signing_address: string;
    signing_algo: string;
  };

  // text format is "request_hash:response_hash"
  const [requestHash, responseHash] = sig.text.split(':');

  return {
    chat_id: chatId,
    model,
    request_hash: requestHash,
    response_hash: responseHash,
    signature: sig.signature,
    signing_address: sig.signing_address,
    signing_algo: sig.signing_algo,
    timestamp: Date.now(),
  };
}

/**
 * Fetch NEAR AI model attestation report.
 * Links the signing_address back to verified TEE hardware (Intel TDX / NVIDIA).
 *
 * GET /v1/attestation/report?model={model}&signing_algo=ecdsa&nonce={random_hex}
 *
 * The attestation proves the model is running inside a genuine TEE environment,
 * providing hardware-level trust for the AI inference.
 */
async function fetchModelAttestation(
  model: string,
  apiKey: string,
): Promise<ModelAttestation> {
  const nonce = randomBytes(32).toString('hex');
  const url = `https://cloud-api.near.ai/v1/attestation/report?model=${encodeURIComponent(model)}&signing_algo=ecdsa&nonce=${nonce}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    throw new Error(`Attestation API returned ${res.status}: ${await res.text()}`);
  }

  const report = await res.json() as {
    signing_address: string;
    attestation_report: string;
    attestation_type?: string;
  };

  return {
    signing_address: report.signing_address,
    model,
    nonce,
    attestation_report: report.attestation_report,
    attestation_type: report.attestation_type,
  };
}
