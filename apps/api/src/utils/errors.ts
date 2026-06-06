import axios from 'axios';

// Sérialise une erreur SANS jamais exposer d'en-têtes sensibles.
// Les erreurs axios contiennent `config.headers.Authorization` (token Twilio,
// clés API Anthropic/OpenAI, etc.) : on ne logge donc QUE status/code/message.
export function safeError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    const data = err.response?.data as { code?: unknown; message?: unknown } | undefined;
    const code = data?.code ?? err.code;
    const message = data?.message ?? err.message;
    return `AxiosError status=${status ?? '?'} code=${code ?? '?'} message=${String(message)}`;
  }
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}
