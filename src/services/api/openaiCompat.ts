import type {
  BetaMessage,
  BetaMessageStreamParams,
  BetaRawMessageStreamEvent,
  BetaStopReason,
  BetaToolUnion,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'

type OpenAIChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | null
  tool_call_id?: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: {
      name: string
      arguments: string
    }
  }>
}

type OpenAIChatRequest = {
  model: string
  stream: boolean
  messages: OpenAIChatMessage[]
  max_completion_tokens?: number
  max_tokens?: number
  stream_options?: {
    include_usage?: boolean
  }
  tools?: Array<{
    type: 'function'
    function: {
      name: string
      description?: string
      parameters?: unknown
    }
  }>
  tool_choice?: 'auto' | { type: 'function'; function: { name: string } }
}

type OpenAIChatChunk = {
  id: string
  model?: string
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
  choices?: Array<{
    index: number
    finish_reason?: string | null
    delta?: {
      role?: string
      content?: string | null
      tool_calls?: Array<{
        index?: number
        id?: string
        type?: 'function'
        function?: {
          name?: string
          arguments?: string
        }
      }>
    }
  }>
}

type OpenAIChatResponse = {
  id: string
  model?: string
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
  choices?: Array<{
    finish_reason?: string | null
    message?: {
      content?: string | null
      tool_calls?: Array<{
        id: string
        type: 'function'
        function: {
          name: string
          arguments: string
        }
      }>
    }
  }>
}

function flattenTextBlocks(
  content: BetaMessageStreamParams['messages'][number]['content'] | string,
): string {
  if (typeof content === 'string') {
    return content
  }
  return content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
}

function toOpenAIMessage(
  message: BetaMessageStreamParams['messages'][number],
): OpenAIChatMessage {
  if (message.role === 'assistant' && Array.isArray(message.content)) {
    const textContent = message.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n')
    const toolCalls = message.content
      .filter(block => block.type === 'tool_use')
      .map(block => ({
        id: block.id,
        type: 'function' as const,
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input ?? {}),
        },
      }))

    return {
      role: 'assistant',
      ...(textContent ? { content: textContent } : { content: null }),
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    }
  }

  if (message.role === 'user' && Array.isArray(message.content)) {
    const toolResultBlocks = message.content.filter(
      block => block.type === 'tool_result',
    )
    if (toolResultBlocks.length > 0) {
      const toolBlock = toolResultBlocks[0]!
      return {
        role: 'tool',
        tool_call_id: toolBlock.tool_use_id,
        content:
          typeof toolBlock.content === 'string'
            ? toolBlock.content
            : JSON.stringify(toolBlock.content),
      }
    }
  }

  return {
    role: message.role === 'assistant' ? 'assistant' : 'user',
    content: flattenTextBlocks(message.content),
  }
}

function toOpenAITools(
  tools?: BetaToolUnion[],
): OpenAIChatRequest['tools'] | undefined {
  if (!tools?.length) {
    return undefined
  }
  return tools
    .filter(tool => 'name' in tool && 'input_schema' in tool)
    .map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        ...(tool.description ? { description: tool.description } : {}),
        parameters: tool.input_schema,
      },
    }))
}

function mapToolChoice(
  toolChoice: BetaMessageStreamParams['tool_choice'],
): OpenAIChatRequest['tool_choice'] | undefined {
  if (!toolChoice) {
    return undefined
  }
  if (toolChoice.type === 'auto') {
    return 'auto'
  }
  if (toolChoice.type === 'tool') {
    return {
      type: 'function',
      function: {
        name: toolChoice.name,
      },
    }
  }
  return undefined
}

export function toOpenAIChatRequest(
  params: Pick<
    BetaMessageStreamParams,
    | 'model'
    | 'max_tokens'
    | 'messages'
    | 'system'
    | 'tools'
    | 'tool_choice'
    | 'stream'
  >,
): OpenAIChatRequest {
  const systemMessages = (params.system ?? []).map(block => ({
    role: 'system' as const,
    content: block.text,
  }))

  return {
    model: params.model,
    stream: params.stream ?? true,
    messages: [...systemMessages, ...params.messages.map(toOpenAIMessage)],
    max_completion_tokens: params.max_tokens,
    max_tokens: params.max_tokens,
    ...(params.stream ? { stream_options: { include_usage: true } } : {}),
    ...(toOpenAITools(params.tools) ? { tools: toOpenAITools(params.tools) } : {}),
    ...(mapToolChoice(params.tool_choice)
      ? { tool_choice: mapToolChoice(params.tool_choice) }
      : {}),
  }
}

function mapFinishReason(
  finishReason?: string | null,
): BetaStopReason | null {
  switch (finishReason) {
    case 'tool_calls':
      return 'tool_use'
    case 'length':
      return 'max_tokens'
    case 'stop':
      return 'end_turn'
    case 'content_filter':
      return 'refusal'
    default:
      return null
  }
}

export function openAIChunkToAnthropicEvents(
  chunk: OpenAIChatChunk,
): BetaRawMessageStreamEvent[] {
  const choice = chunk.choices?.[0]
  if (!choice) {
    return []
  }

  const events: BetaRawMessageStreamEvent[] = [
    {
      type: 'message_start',
      message: {
        id: chunk.id,
        type: 'message',
        role: 'assistant',
        model: chunk.model ?? '',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: 0,
          output_tokens: 0,
        },
      } as BetaMessage,
    },
  ]

  let contentIndex = 0
  if (choice.delta?.content) {
    events.push({
      type: 'content_block_start',
      index: contentIndex,
      content_block: {
        type: 'text',
        text: '',
      },
    } as BetaRawMessageStreamEvent)
    events.push({
      type: 'content_block_delta',
      index: contentIndex,
      delta: {
        type: 'text_delta',
        text: choice.delta.content,
      },
    } as BetaRawMessageStreamEvent)
    events.push({
      type: 'content_block_stop',
      index: contentIndex,
    } as BetaRawMessageStreamEvent)
    contentIndex++
  }

  for (const toolCall of choice.delta?.tool_calls ?? []) {
    events.push({
      type: 'content_block_start',
      index: contentIndex,
      content_block: {
        type: 'tool_use',
        id: toolCall.id ?? `tool_call_${contentIndex}`,
        name: toolCall.function?.name ?? '',
        input: {},
      },
    } as BetaRawMessageStreamEvent)
    events.push({
      type: 'content_block_delta',
      index: contentIndex,
      delta: {
        type: 'input_json_delta',
        partial_json: toolCall.function?.arguments ?? '',
      },
    } as BetaRawMessageStreamEvent)
    events.push({
      type: 'content_block_stop',
      index: contentIndex,
    } as BetaRawMessageStreamEvent)
    contentIndex++
  }

  events.push({
    type: 'message_delta',
    delta: {
      stop_reason: mapFinishReason(choice.finish_reason),
      stop_sequence: null,
    },
    usage: {
      input_tokens: chunk.usage?.prompt_tokens ?? 0,
      output_tokens: chunk.usage?.completion_tokens ?? 0,
    },
  } as BetaRawMessageStreamEvent)
  events.push({
    type: 'message_stop',
  } as BetaRawMessageStreamEvent)

  return events
}

export function getOpenAIPath(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, '')
  if (normalized.endsWith('/chat/completions')) {
    return normalized
  }
  if (normalized.endsWith('/v1')) {
    return `${normalized}/chat/completions`
  }
  return `${normalized}/v1/chat/completions`
}

export function openAIResponseToBetaMessage(
  response: OpenAIChatResponse,
): BetaMessage {
  const choice = response.choices?.[0]
  const content = []
  if (choice?.message?.content) {
    content.push({
      type: 'text',
      text: choice.message.content,
    })
  }
  for (const toolCall of choice?.message?.tool_calls ?? []) {
    let parsedInput: unknown = {}
    try {
      parsedInput = JSON.parse(toolCall.function.arguments || '{}')
    } catch {
      parsedInput = toolCall.function.arguments || ''
    }
    content.push({
      type: 'tool_use',
      id: toolCall.id,
      name: toolCall.function.name,
      input: parsedInput,
    })
  }

  return {
    id: response.id,
    type: 'message',
    role: 'assistant',
    model: response.model ?? '',
    content,
    stop_reason: mapFinishReason(choice?.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: response.usage?.prompt_tokens ?? 0,
      output_tokens: response.usage?.completion_tokens ?? 0,
    },
  } as BetaMessage
}
