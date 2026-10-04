export type AIProvider = 'local' | 'openai' | 'gemini' | 'anthropic' | 'deepseek' | 'openrouter'
export const AI_PROVIDERS = {
  local: { label: '로컬 Ollama', docs: 'https://docs.ollama.com/api/chat', keys: 'https://ollama.com/download' },
  openai: { label: 'OpenAI', docs: 'https://platform.openai.com/docs/models', keys: 'https://platform.openai.com/api-keys' },
  gemini: { label: 'Google Gemini', docs: 'https://ai.google.dev/gemini-api/docs/models', keys: 'https://aistudio.google.com/apikey' },
  anthropic: { label: 'Anthropic Claude', docs: 'https://platform.claude.com/docs/en/about-claude/models/overview', keys: 'https://platform.claude.com/settings/keys' },
  deepseek: { label: 'DeepSeek', docs: 'https://api-docs.deepseek.com/quick_start/pricing', keys: 'https://platform.deepseek.com/api_keys' },
  openrouter: { label: 'OpenRouter · 여러 모델', docs: 'https://openrouter.ai/models', keys: 'https://openrouter.ai/settings/keys' },
} as const
export type ProjectAIConfig = { project: string; provider: AIProvider; model: string; instructions: string; batchChars: number }
export type AIRun = { id: string; provider: AIProvider; model: string; pendingIds: string[]; total: number; completed: number; addedTerms: number; conflicts: number; status: 'running' | 'paused' | 'failed' | 'completed'; updatedAt: string; error?: string }
export type AITermOrigin = { provider: AIProvider; model: string; documentId: string; segmentId: string; quote: string; createdAt: string }
export type AITermSuggestion = { id: string; termId: string; project: string; source: string; target: string; note: string; origin: AITermOrigin; status: 'pending' | 'dismissed' | 'accepted' }
