"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const prisma_1 = require("@/generated/prisma");
const adapter_pg_1 = require("@prisma/adapter-pg");
const connectionString = process.env.DIRECT_URL;
const adapter = new adapter_pg_1.PrismaPg({ connectionString });
const prisma = global.prisma ||
    new prisma_1.PrismaClient({
        adapter,
        log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
        errorFormat: "minimal",
    });
if (process.env.NODE_ENV !== "production") {
    global.prisma = prisma;
}
exports.default = prisma;
