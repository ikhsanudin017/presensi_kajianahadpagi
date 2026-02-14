import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const rawDatasourceUrl =
  process.env.POSTGRES_PRISMA_URL ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL_NON_POOLING ||
  undefined;

function withPrismaPoolParams(urlValue?: string) {
  if (!urlValue) {
    return undefined;
  }

  try {
    const url = new URL(urlValue);
    if (!url.protocol.startsWith("postgres")) {
      return urlValue;
    }

    const defaultConnectionLimit = process.env.NODE_ENV === "production" ? "5" : "3";
    const connectionLimit = process.env.PRISMA_CONNECTION_LIMIT ?? defaultConnectionLimit;
    const poolTimeout = process.env.PRISMA_POOL_TIMEOUT ?? "30";

    if (!url.searchParams.has("connection_limit")) {
      url.searchParams.set("connection_limit", connectionLimit);
    }
    if (!url.searchParams.has("pool_timeout")) {
      url.searchParams.set("pool_timeout", poolTimeout);
    }

    return url.toString();
  } catch {
    return urlValue;
  }
}

const datasourceUrl = withPrismaPoolParams(rawDatasourceUrl);

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ["warn", "error"],
    datasources: datasourceUrl
      ? {
          db: {
            url: datasourceUrl,
          },
        }
      : undefined,
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
