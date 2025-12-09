import { generateRequestId } from './idGenerator.js';

const THINKING_HINT = '<antml\b:thinking_mode>interleaved</antml><antml\b:max_thinking_length>16000</antml>';
const THINKING_START_TAG = '<thinking>';
const THINKING_END_TAG = '</thinking>';

function normalizeBlocks(content, triggerSignal) {
  if (typeof content === 'string') {
    return content
      .replace(/<invoke\b[^>]*>[\s\S]*?<\/invoke>/gi, '')
      .replace(/<tool_result\b[^>]*>[\s\S]*?<\/tool_result>/gi, '');
  }

  return content
    .map(block => {
      if (!block || typeof block !== 'object') return '';
      if (block.type === 'text') {
        return (block.text || '')
          .replace(/<invoke\b[^>]*>[\s\S]*?<\/invoke>/gi, '')
          .replace(/<tool_result\b[^>]*>[\s\S]*?<\/tool_result>/gi, '');
      }
      if (block.type === 'thinking') {
        return `${THINKING_START_TAG}${block.thinking || ''}${THINKING_END_TAG}`;
      }
      if (block.type === 'tool_result') {
        return `<tool_result id="${block.tool_use_id}">${block.content ?? ''}</tool_result>`;
      }
      if (block.type === 'tool_use') {
        const params = Object.entries(block.input ?? {})
          .map(([key, value]) => {
            const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
            return `<parameter name="${key}">${stringValue}</parameter>`;
          })
          .join('\n');
        const trigger = triggerSignal ? `${triggerSignal}\n` : '';
        return `${trigger}<invoke name="${block.name}">\n${params}\n</invoke>`;
      }
      return '';
    })
    .join('\n');
}

function mapClaudeRole(role) {
  return role === 'assistant' ? 'assistant' : 'user';
}

export function mapClaudeToOpenAI(body, triggerSignal) {
  if (!body || typeof body !== 'object') {
    throw new Error('请求体格式不合法');
  }
  if (typeof body.max_tokens !== 'number' || Number.isNaN(body.max_tokens)) {
    throw new Error('max_tokens 是必填数字');
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw new Error('messages 不能为空');
  }

  const messages = [];

  if (body.system) {
    const systemContent = Array.isArray(body.system)
      ? body.system
          .map(block => {
            if (typeof block === 'string') return block;
            if (block && typeof block === 'object' && 'text' in block) {
              return block.text || '';
            }
            return '';
          })
          .join('\n')
      : body.system;
    messages.push({ role: 'system', content: systemContent });
  }

  for (const message of body.messages) {
    const normalized = normalizeBlocks(message.content, triggerSignal);
    let content = normalized;
    if (message.role === 'user' && body.thinking && body.thinking.type === 'enabled') {
      content = `${content}${THINKING_HINT}`;
    }
    messages.push({
      role: mapClaudeRole(message.role),
      content
    });
  }

  return {
    model: body.model,
    stream: body.stream !== false,
    temperature: body.temperature ?? 0.2,
    top_p: body.top_p ?? 1,
    max_tokens: body.max_tokens,
    messages
  };
}

export function mapClaudeToolsToOpenAITools(tools = []) {
  if (!Array.isArray(tools)) return [];
  return tools.map(tool => ({
    type: 'function',
    function: {
      name: tool?.name,
      description: tool?.description,
      parameters: tool?.input_schema || {}
    }
  }));
}

function safeJsonParse(raw, fallback) {
  if (typeof raw !== 'string') return raw ?? fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function convertToolCallsToClaudeBlocks(toolCalls = []) {
  return (toolCalls || []).map(call => {
    const args = safeJsonParse(call?.function?.arguments, call?.function?.arguments || {});
    return {
      type: 'tool_use',
      id: call?.id || `toolu_${generateRequestId()}`,
      name: call?.function?.name || 'tool',
      input: args || {}
    };
  });
}

export function estimateTokensFromText(text) {
  if (!text) return 0;
  const normalized = typeof text === 'string' ? text : JSON.stringify(text);
  return Math.max(1, Math.ceil(normalized.length / 4));
}

function extractTextFromClaudeMessages(messages = []) {
  return messages
    .map(msg => {
      if (typeof msg?.content === 'string') return msg.content;
      if (!Array.isArray(msg?.content)) return '';
      return msg.content
        .map(block => {
          if (!block || typeof block !== 'object') return '';
          if (block.type === 'text') return block.text || '';
          if (block.type === 'thinking') return block.thinking || '';
          if (block.type === 'tool_use') {
            return `<invoke name="${block.name}">${JSON.stringify(block.input || {})}</invoke>`;
          }
          if (block.type === 'tool_result') {
            return `<tool_result id="${block.tool_use_id}">${block.content ?? ''}</tool_result>`;
          }
          return '';
        })
        .join('');
    })
    .join('\n');
}

export function countClaudeTokens(request) {
  if (!request || !Array.isArray(request.messages)) {
    throw new Error('messages 不能为空');
  }

  let totalText = extractTextFromClaudeMessages(request.messages);

  if (request.system) {
    const systemText = Array.isArray(request.system)
      ? request.system.map(block => (typeof block === 'string' ? block : block?.text || '')).join('\n')
      : request.system;
    totalText += `\n${systemText || ''}`;
  }

  if (request.tools && request.tools.length > 0) {
    totalText += `\n${JSON.stringify(request.tools)}`;
  }

  const inputTokens = estimateTokensFromText(totalText);

  return {
    input_tokens: inputTokens,
    token_count: inputTokens,
    tokens: inputTokens
  };
}

function buildMessageStartPayload(requestId, model, inputTokens = 0) {
  return {
    type: 'message_start',
    message: {
      id: `msg_${requestId}`,
      type: 'message',
      role: 'assistant',
      model: model || 'claude-proxy',
      stop_sequence: null,
      usage: {
        input_tokens: inputTokens || 0,
        output_tokens: 0
      },
      content: [],
      stop_reason: null
    }
  };
}

function writeSSE(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export class ClaudeSseEmitter {
  constructor(res, requestId, { model, inputTokens } = {}) {
    this.res = res;
    this.requestId = requestId || generateRequestId();
    this.model = model || 'claude-proxy';
    this.inputTokens = inputTokens || 0;
    this.nextIndex = 0;
    this.textBlockIndex = null;
    this.thinkingBlockIndex = null;
    this.finished = false;
    this.totalOutputTokens = 0;
  }

  start() {
    writeSSE(this.res, 'message_start', buildMessageStartPayload(this.requestId, this.model, this.inputTokens));
  }

  ensureTextBlock() {
    if (this.textBlockIndex !== null) return;
    this.textBlockIndex = this.nextIndex++;
    writeSSE(this.res, 'content_block_start', {
      type: 'content_block_start',
      index: this.textBlockIndex,
      content_block: { type: 'text', text: '' }
    });
  }

  ensureThinkingBlock() {
    if (this.thinkingBlockIndex !== null) return;
    this.thinkingBlockIndex = this.nextIndex++;
    writeSSE(this.res, 'content_block_start', {
      type: 'content_block_start',
      index: this.thinkingBlockIndex,
      content_block: { type: 'thinking', thinking: '' }
    });
  }

  sendText(text) {
    if (!text) return;
    // 确保思考块先结束，避免与正文交叉
    this.closeThinkingBlock();
    this.ensureTextBlock();
    this.totalOutputTokens += estimateTokensFromText(text);
    writeSSE(this.res, 'content_block_delta', {
      type: 'content_block_delta',
      index: this.textBlockIndex,
      delta: { type: 'text_delta', text }
    });
  }

  sendThinking(thinking) {
    if (!thinking) return;
    // thinking 到来时关闭已有正文块，避免嵌套
    this.closeTextBlock();
    this.ensureThinkingBlock();
    this.totalOutputTokens += estimateTokensFromText(thinking);
    writeSSE(this.res, 'content_block_delta', {
      type: 'content_block_delta',
      index: this.thinkingBlockIndex,
      delta: { type: 'thinking_delta', thinking }
    });
  }

  async sendToolCalls(toolCalls = []) {
    if (!toolCalls || toolCalls.length === 0) return;
    await this.closeTextBlock();
    await this.closeThinkingBlock();

    toolCalls.forEach(call => {
      const index = this.nextIndex++;
      const args = call?.function?.arguments ?? '{}';
      const inputJson = typeof args === 'string' ? args : JSON.stringify(args);
      this.totalOutputTokens += estimateTokensFromText(inputJson);
      writeSSE(this.res, 'content_block_start', {
        type: 'content_block_start',
        index,
        content_block: {
          type: 'tool_use',
          id: call.id || `toolu_${generateRequestId()}`,
          name: call?.function?.name || 'tool',
          input: {}
        }
      });
      writeSSE(this.res, 'content_block_delta', {
        type: 'content_block_delta',
        index,
        delta: { type: 'input_json_delta', partial_json: inputJson }
      });
      writeSSE(this.res, 'content_block_stop', { type: 'content_block_stop', index });
    });
  }

  async closeTextBlock() {
    if (this.textBlockIndex === null) return;
    const index = this.textBlockIndex;
    this.textBlockIndex = null;
    writeSSE(this.res, 'content_block_stop', { type: 'content_block_stop', index });
  }

  async closeThinkingBlock() {
    if (this.thinkingBlockIndex === null) return;
    const index = this.thinkingBlockIndex;
    this.thinkingBlockIndex = null;
    writeSSE(this.res, 'content_block_stop', { type: 'content_block_stop', index });
  }

  finish(usage) {
    if (this.finished) return;
    this.finished = true;
    this.closeTextBlock();
    this.closeThinkingBlock();

    const outputTokens =
      usage?.completion_tokens ??
      usage?.output_tokens ??
      (this.totalOutputTokens ?? 0);
    const inputTokens =
      usage?.prompt_tokens ??
      usage?.input_tokens ??
      (this.inputTokens ?? null);

    writeSSE(this.res, 'message_delta', {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: {
        input_tokens: inputTokens || 0,
        output_tokens: outputTokens || 0
      }
    });
    writeSSE(this.res, 'message_stop', { type: 'message_stop' });
    this.res.end();
  }
}

export function buildClaudeContentBlocks(content, toolCalls = []) {
  const blocks = [];
  if (content) {
    blocks.push({ type: 'text', text: content });
  }
  if (toolCalls && toolCalls.length > 0) {
    blocks.push(...convertToolCallsToClaudeBlocks(toolCalls));
  }
  return blocks;
}
