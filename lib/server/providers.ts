import { openrouter } from './desktop-providers/openrouter';
import { google } from './desktop-providers/google';
import { cloudflare } from './desktop-providers/cloudflare';
import { nvidia, groq, huggingface, cerebras, mistral, openAICompatible } from './desktop-providers/openaiCompatible';
export const adapters = [groq, openrouter, nvidia, google, cloudflare, huggingface, cerebras, mistral, openAICompatible({ id:'openai', name:'OpenAI', baseUrl:'https://api.openai.com/v1', signupUrl:'https://platform.openai.com/api-keys', freeNotes:'Uses your OpenAI API account.', freeStatus:'paid' })];
export const envNames: Record<string, string[]> = { openai:['OPENAI_API_KEY'], openrouter:['OPENROUTER_API_KEY'], nvidia:['NVIDIA_API_KEY','NGC_API_KEY'], groq:['GROQ_API_KEY'], google:['GEMINI_API_KEY','GOOGLE_API_KEY'], cloudflare:['CLOUDFLARE_API_TOKEN','CF_API_TOKEN'], huggingface:['HF_TOKEN','HUGGINGFACE_API_KEY'], cerebras:['CEREBRAS_API_KEY'], mistral:['MISTRAL_API_KEY'] };
