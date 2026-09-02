import { PrismaPg } from "@prisma/adapter-pg";
console.log(typeof PrismaPg);
const adapter = new PrismaPg({ connectionString: "postgres://postgres:postgres@localhost:5432/postgres" } as any);
console.log(adapter);
