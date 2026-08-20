import EventSource from 'react-native-sse';

import {ApiSettings, MessageRole} from '../types';
import type {StructuredModelMessage} from '../visualization/types';

export type ApiMessage = {
  role: MessageRole;
  content: string;
};

type ChatCompletionChunk = {
  choices?: Array<{
    delta?: {
      content?: string | null;
    };
  }>;
  error?: {
    message?: string;
  };
};

type StreamEvent = {
  data?: string | null;
  message?: string;
  error?: unknown;
};

export type ChatStream = {
  close: () => void;
  done: Promise<void>;
};

function completionsUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  return normalized.endsWith('/chat/completions')
    ? normalized
    : `${normalized}/chat/completions`;
}

function errorMessage(event: StreamEvent): string {
  if (event.data) {
    try {
      const payload = JSON.parse(event.data) as ChatCompletionChunk;
      if (payload.error?.message) {
        return payload.error.message;
      }
    } catch {
      // The provider may return a plain-text error body.
    }
  }

  if (event.message) {
    return event.message;
  }

  if (event.error instanceof Error) {
    return event.error.message;
  }

  return 'The API connection failed.';
}

export function streamChatCompletion(
  settings: ApiSettings,
  apiKey: string,
  messages: ApiMessage[],
  onDelta: (text: string) => void,
): ChatStream {
  let settled = false;
  let resolveDone!: () => void;
  let rejectDone!: (error: Error) => void;

  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });

  const source = new EventSource(completionsUrl(settings.baseUrl), {
    method: 'POST',
    headers: {
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey.trim()}`,
    },
    body: JSON.stringify({
      model: settings.model.trim(),
      messages,
      temperature: settings.temperature,
      max_tokens: settings.maxTokens,
      stream: true,
    }),
    pollingInterval: 0,
  });

  const cleanup = () => {
    source.removeAllEventListeners();
    source.close();
  };

  const complete = () => {
    if (!settled) {
      settled = true;
      cleanup();
      resolveDone();
    }
  };

  const fail = (event: unknown) => {
    if (!settled) {
      settled = true;
      cleanup();
      rejectDone(new Error(errorMessage(event as StreamEvent)));
    }
  };

  source.addEventListener('message', (event: StreamEvent) => {
    if (!event.data) {
      return;
    }

    if (event.data === '[DONE]') {
      complete();
      return;
    }

    try {
      const chunk = JSON.parse(event.data) as ChatCompletionChunk;
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        onDelta(delta);
      }
    } catch {
      fail({
        data: event.data,
        message: 'The API returned invalid stream data.',
      });
    }
  });

  source.addEventListener('error', fail);

  return {
    close: complete,
    done,
  };
}

type JsonCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  error?: {
    message?: string;
  };
};

function parseJsonContent(content: string): unknown {
  const trimmed = content.trim();
  const unfenced = trimmed.startsWith('```')
    ? trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    : trimmed;
  return JSON.parse(unfenced);
}

export async function completeJson<T>(
  settings: ApiSettings,
  apiKey: string,
  messages: StructuredModelMessage[],
): Promise<T> {
  const response = await fetch(completionsUrl(settings.baseUrl), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey.trim()}`,
    },
    body: JSON.stringify({
      model: settings.model.trim(),
      messages,
      temperature: settings.temperature,
      max_tokens: settings.maxTokens,
      stream: false,
    }),
  });

  const payload = (await response
    .json()
    .catch(() => ({}))) as JsonCompletionResponse;
  if (!response.ok) {
    throw new Error(
      payload.error?.message ?? `The API request failed (${response.status}).`,
    );
  }
  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('The API returned an empty structured response.');
  }
  try {
    return parseJsonContent(content) as T;
  } catch {
    throw new Error(
      'The API returned invalid JSON for the visualization stage.',
    );
  }
}
