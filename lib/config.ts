/**
 * Central environment configuration. All secrets are read from
 * process.env at runtime — never hardcode keys anywhere in the codebase.
 */

export const env = {
  geminiApiKey: process.env.GEMINI_API_KEY ?? "",
  cohereApiKey: process.env.COHERE_API_KEY ?? "",
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  langfusePublicKey: process.env.NEXT_PUBLIC_LANGFUSE_PUBLIC_KEY ?? "",
  langfuseSecretKey: process.env.LANGFUSE_SECRET_KEY ?? "",
  langfuseHost: process.env.NEXT_PUBLIC_LANGFUSE_HOST ?? "https://cloud.langfuse.com",
};

export const isServerEnvComplete = (): boolean => {
  return Boolean(
    env.geminiApiKey &&
      env.supabaseUrl &&
      env.supabaseServiceRoleKey
  );
};

export const hasCohere = (): boolean => Boolean(env.cohereApiKey);
export const hasLangfuse = (): boolean =>
  Boolean(env.langfusePublicKey && env.langfuseSecretKey);