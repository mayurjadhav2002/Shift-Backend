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
import contactRouter from "./routes/contact";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import depthLimit from "graphql-depth-limit";

const startServer = async () => {
  const app = express();

  // Security Middleware
  app.use(
    helmet({
      crossOriginEmbedderPolicy: false,
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: [
            "'self'",
            "'unsafe-inline'",
            "https://sandbox.embed.apollographql.com",
          ],
          frameSrc: ["'self'", "https://sandbox.embed.apollographql.com"],
        },
      },
    })
  );

  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: "Too many requests from this IP, please try again after 15 minutes",
  });
  
  app.use("/graphql", limiter);

  app.use(cors());
  app.use(express.json({ limit: "50mb" }));

  const server = new ApolloServer<MyContext>({
    typeDefs,
    resolvers,
    validationRules: [depthLimit(5)], // Prevent deeply nested malicious queries
  });

  await server.start();

  // Authentication check for GraphQL
  app.use("/graphql", (req: any, res: any, next: any) => {
    const ctx = getUserContext(req.headers.authorization);
    const query = req.body?.query || "";
    const operationName = req.body?.operationName || "";

    const isAuthOperation =
      query.includes("mutation Login") ||
      query.includes("mutation SignUp") ||
      query.includes("mutation CreateUser") ||
      query.includes("mutation LoginWithGoogle") ||
      query.includes("login") ||
      query.includes("signUp") ||
      query.includes("createUser") ||
      query.includes("loginWithGoogle") ||
      query.includes("IntrospectionQuery") ||
      operationName === "IntrospectionQuery";

    if (!ctx.userId && !isAuthOperation) {
      return res.status(401).json({
        errors: [
          {
            message: "Unauthorized. You must be logged in to access this endpoint.",
          },
        ],
      });
    }

    req.userId = ctx.userId;
    next();
  });

  app.use(
    "/graphql",
    expressMiddleware(server, {
      context: async ({ req }: { req: any }) => {
        if (req.userId) return { userId: req.userId };
        return getUserContext(req.headers.authorization);
      },
    }),
  );

  // REST routes
  app.use("/api/contact", contactRouter);

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
