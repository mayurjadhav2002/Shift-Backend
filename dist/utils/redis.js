"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const ioredis_1 = __importDefault(require("ioredis"));
const redis = new ioredis_1.default(process.env.REDIS_URL);
// const redis = new Redis.Cluster(
//   [{ host: 'auron-redis-server-gk4j7p.serverless.use1.cache.amazonaws.com', port: 6379 }],
//   {
//     dnsLookup: (address, callback) => callback(null, address),
//     redisOptions: {
//       tls: {},
//     },
//   });
redis.on("connect", () => console.log("Redis Connected"));
redis.on("error", (err) => console.error("❌ Redis error", err));
exports.default = redis;
