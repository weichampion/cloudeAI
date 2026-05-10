/**
 * Unified AI Client Wrapper
 * 提供 OpenAI 兼容接口，内部自动路由到 OpenAI SDK 或 Anthropic SDK。
 * 当 baseURL 包含 "anthropic" 时使用 Anthropic SDK，否则使用 OpenAI SDK。
 */
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

function isAnthropicBase(baseURL) {
  return typeof baseURL === 'string' && baseURL.includes('anthropic');
}

/* ─── 消息格式转换 (OpenAI → Anthropic) ─── */

function toAnthropicMessages(messages) {
  let system = '';
  const result = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system += (system ? '\n' : '') + msg.content;
      continue;
    }

    if (msg.role === 'tool') {
      // tool result → 追加到上一条 user 消息的 tool_result 内容块
      const last = result[result.length - 1];
      if (last?.role === 'user' && Array.isArray(last.content)) {
        last.content.push({
          type: 'tool_result',
          tool_use_id: msg.tool_call_id,
          content: msg.content,
        });
      } else {
        result.push({
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: msg.tool_call_id,
            content: msg.content,
          }],
        });
      }
      continue;
    }

    if (msg.role === 'assistant' && msg.tool_calls) {
      // assistant + tool_calls → 内容块格式
      const blocks = [];
      if (msg.content) blocks.push({ type: 'text', text: msg.content });
      for (const tc of msg.tool_calls) {
        let input = {};
        try { input = JSON.parse(tc.function.arguments || '{}'); } catch {}
        blocks.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input,
        });
      }
      result.push({ role: 'assistant', content: blocks });
      continue;
    }

    // 普通 user / assistant 消息
    result.push({ role: msg.role, content: msg.content || '' });
  }

  // Anthropic 要求第一条消息必须是 user
  if (result.length > 0 && result[0].role !== 'user') {
    result.unshift({ role: 'user', content: '(continue)' });
  }

  // 合并连续同角色消息
  const merged = [];
  for (const msg of result) {
    const last = merged[merged.length - 1];
    if (last && last.role === msg.role) {
      const a = typeof last.content === 'string' ? last.content : '';
      const b = typeof msg.content === 'string' ? msg.content : '';
      if (typeof last.content === 'string' && typeof msg.content === 'string') {
        last.content = a + '\n' + b;
      } else {
        // 混合类型 → 转为数组
        const blocks = Array.isArray(last.content) ? [...last.content] : [{ type: 'text', text: a }];
        if (typeof msg.content === 'string') {
          blocks.push({ type: 'text', text: b });
        } else if (Array.isArray(msg.content)) {
          blocks.push(...msg.content);
        }
        last.content = blocks;
      }
    } else {
      merged.push({ ...msg });
    }
  }

  return { system, messages: merged };
}

/* ─── 工具格式转换 (OpenAI → Anthropic) ─── */

function toAnthropicTools(tools) {
  if (!tools?.length) return undefined;
  return tools
    .filter(t => t.type === 'function' && t.function)
    .map(t => ({
      name: t.function.name,
      description: t.function.description || '',
      input_schema: t.function.parameters || { type: 'object', properties: {} },
    }));
}

/* ─── Anthropic 响应 → OpenAI 格式 ─── */

function toOpenAIFinishReason(stopReason) {
  if (stopReason === 'tool_use') return 'tool_calls';
  if (stopReason === 'max_tokens') return 'length';
  return 'stop';
}

function toOpenAIResponse(anthropicMsg) {
  const textParts = [];
  const toolCalls = [];

  for (const block of anthropicMsg.content || []) {
    if (block.type === 'text') {
      textParts.push(block.text);
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input || {}),
        },
      });
    }
  }

  return {
    choices: [{
      message: {
        role: 'assistant',
        content: textParts.join('') || null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      },
      finish_reason: toOpenAIFinishReason(anthropicMsg.stop_reason),
    }],
  };
}

/* ─── Anthropic 流式 → OpenAI 兼容 async iterable ─── */

async function* anthropicStreamToOpenAI(anthropicStream) {
  let currentToolIndex = -1;

  for await (const event of anthropicStream) {
    switch (event.type) {
      case 'content_block_start':
        if (event.content_block?.type === 'tool_use') {
          currentToolIndex++;
          yield {
            choices: [{
              delta: {
                tool_calls: [{
                  index: currentToolIndex,
                  id: event.content_block.id,
                  type: 'function',
                  function: {
                    name: event.content_block.name,
                    arguments: '',
                  },
                }],
              },
            }],
          };
        }
        break;

      case 'content_block_delta':
        if (event.delta?.type === 'text_delta' && event.delta.text) {
          yield { choices: [{ delta: { content: event.delta.text } }] };
        } else if (event.delta?.type === 'input_json_delta') {
          yield {
            choices: [{
              delta: {
                tool_calls: [{
                  index: currentToolIndex,
                  function: { arguments: event.delta.partial_json || '' },
                }],
              },
            }],
          };
        }
        break;

      case 'message_delta':
        // 流结束信息，不需要特殊处理
        break;

      default:
        break;
    }
  }
}

/* ─── Anthropic 兼容的 OpenAI 风格 Wrapper ─── */

class AnthropicCompletionsWrapper {
  constructor(client) {
    this._client = client;
  }

  async create(params) {
    const { system, messages } = toAnthropicMessages(params.messages || []);
    const tools = toAnthropicTools(params.tools);

    const anthropicParams = {
      model: params.model,
      max_tokens: params.max_tokens || 8192,
      messages,
      ...(system ? { system } : {}),
      ...(tools ? { tools, tool_choice: { type: 'auto' } } : {}),
      ...(params.signal ? { signal: params.signal } : {}),
    };

    if (params.stream) {
      const stream = await this._client.messages.create({ ...anthropicParams, stream: true });
      return anthropicStreamToOpenAI(stream);
    }

    const response = await this._client.messages.create(anthropicParams);
    return toOpenAIResponse(response);
  }
}

class AnthropicClientWrapper {
  constructor(client) {
    this._client = client;
    this.chat = { completions: new AnthropicCompletionsWrapper(client) };
  }
}

/* ─── 工厂函数 ─── */

/**
 * 创建统一 AI 客户端
 * - baseURL 包含 "anthropic" → 返回 Anthropic 包装器（兼容 OpenAI 接口）
 * - 否则 → 返回原生 OpenAI 客户端
 */
export function createAIClient(apiKey, baseURL) {
  if (isAnthropicBase(baseURL)) {
    return new AnthropicClientWrapper(new Anthropic({ apiKey, baseURL }));
  }
  return new OpenAI({ apiKey, baseURL });
}

/**
 * 判断当前配置是否使用 Anthropic API
 */
export function isAnthropic(baseURL) {
  return isAnthropicBase(baseURL);
}
