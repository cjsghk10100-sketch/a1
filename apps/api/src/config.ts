export interface AppConfig {
  port: number;
  databaseUrl: string;
}

function parsePort(raw: string | undefined): number {
  if (!raw) return 3000;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0 || n > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  return n;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function loadConfig(): AppConfig {
  return {
    port: parsePort(process.env.PORT),
    databaseUrl: requireEnv("DATABASE_URL"),
  };
}
