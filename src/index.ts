import "dotenv/config";
import express, { Request, Response } from "express";
import cors from "cors";
import { ApolloServer } from "@apollo/server";
import { expressMiddleware } from "@as-integrations/express5";
import { typeDefs } from "./graphql/typeDefs";
import { resolvers } from "./graphql/resolvers";
import { getUserContext, MyContext } from "./middleware/auth";
import { createServer } from "http";
import { setupSocketServer } from "./socket";

const startServer = async () => {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "50mb" }));

  const server = new ApolloServer<MyContext>({
    typeDefs,
    resolvers,
  });

  await server.start();

  app.use(
    "/graphql",
    expressMiddleware(server, {
      context: async ({ req }: { req: any }) =>
        getUserContext(req.headers.authorization),
    }),
  );

  app.get("/", (req: any, res: any) => {
    res.json({ message: "Hello from Shift Backend!" });
  });

  const PORT = process.env.PORT || 3000;

  const httpServer = createServer(app);
  setupSocketServer(httpServer);

  httpServer.listen(Number(PORT), "0.0.0.0", () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`GraphQL endpoint: http://localhost:${PORT}/graphql`);
  });
};

startServer().catch((err) => console.error(err));
