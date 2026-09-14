import { PrismaClient } from "../generated/prisma/client.js";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { env } from "./env.js";

const adapter = new PrismaMariaDb({
  host: env.database.host,
  port: env.database.port,
  user: env.database.user,
  password: env.database.password,
  database: env.database.name,
});

const prisma = new PrismaClient({ adapter });

export default prisma;
