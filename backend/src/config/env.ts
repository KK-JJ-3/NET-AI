import "dotenv/config";

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export const env = {
  port: Number(process.env.PORT) || 5000,
  nodeEnv: process.env.NODE_ENV || "development",

  jwtSecret: requireEnv("JWT_SECRET"),

  database: {
    host: requireEnv("DB_HOST"),
    port: Number(process.env.DB_PORT) || 3306,
    user: requireEnv("DB_USER"),
    password: requireEnv("DB_PASSWORD"),
    name: requireEnv("DB_NAME"),
  },
} as const;
