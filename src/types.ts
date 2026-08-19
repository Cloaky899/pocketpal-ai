export type MessageRole = 'system' | 'user' | 'assistant';

export type ChatMessage = {
  id: string;
  role: Exclude<MessageRole, 'system'>;
  content: string;
  createdAt: number;
};

export type ApiSettings = {
  baseUrl: string;
  model: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  rendererUrl: string;
};

export const DEFAULT_SETTINGS: ApiSettings = {
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  temperature: 0.7,
  maxTokens: 1024,
  systemPrompt: 'You are a helpful, concise assistant.',
  rendererUrl: '',
};
