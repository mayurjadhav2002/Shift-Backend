import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL!);

// const redis = new Redis.Cluster(
//   [{ host: 'auron-redis-server-gk4j7p.serverless.use1.cache.amazonaws.com', port: 6379 }],
//   {
//     dnsLookup: (address, callback) => callback(null, address),
//     redisOptions: {
//       tls: {},
//     },
//   });
redis.on("connect", () => console.log("Redis Connected"));
redis.on("error", (err: any) => console.error("❌ Redis error", err));

export default redis;
