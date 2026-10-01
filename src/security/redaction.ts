// Best-effort presentation/export masking. Raw local run data remain sensitive.
export function redact(text: string): string {
  return text.replace(/\b(?:sk-[a-zA-Z0-9_-]{12,}|gh[pousr]_[a-zA-Z0-9]{20,}|github_pat_[a-zA-Z0-9_]{20,})\b/g, '[REDACTED]')
    .replace(/((?:api[_-]?key|password|secret|access[_-]?token|authorization)\s*[=:]\s*["']?)([^\s"',;]+)(["']?)/gi, '$1[REDACTED]$3')
    .replace(/(Bearer\s+)[a-zA-Z0-9._-]+/gi, '$1[REDACTED]')
    .replace(/([?&](?:token|sig|signature|X-Amz-Signature|X-Goog-Signature)=)[^&\s"']+/gi, '$1[REDACTED]');
}
export function masked(value: unknown): unknown {
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map(masked);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) =>
    [key, /^(api[_-]?key|password|secret|access[_-]?token|authorization)$/i.test(key) ? '[REDACTED]' : masked(item)]));
  return value;
}
