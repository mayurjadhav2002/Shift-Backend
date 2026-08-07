"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const server_1 = require("@apollo/server");
const express5_1 = require("@as-integrations/express5");
const typeDefs_1 = require("./graphql/typeDefs");
const resolvers_1 = require("./graphql/resolvers");
const auth_1 = require("./middleware/auth");
const http_1 = require("http");
const socket_1 = require("./socket");
const startServer = async () => {
    const app = (0, express_1.default)();
    app.use((0, cors_1.default)());
    app.use(express_1.default.json({ limit: "50mb" }));
    const server = new server_1.ApolloServer({
        typeDefs: typeDefs_1.typeDefs,
        resolvers: resolvers_1.resolvers,
    });
    await server.start();
    app.use("/graphql", (0, express5_1.expressMiddleware)(server, {
        context: async ({ req }) => (0, auth_1.getUserContext)(req.headers.authorization),
    }));
    app.get("/", (req, res) => {
        res.json({ message: "Hello from Shift Backend!" });
    });
    const PORT = process.env.PORT || 3000;
    const httpServer = (0, http_1.createServer)(app);
    (0, socket_1.setupSocketServer)(httpServer);
    httpServer.listen(Number(PORT), "0.0.0.0", () => {
        console.log(`Server is running on port ${PORT}`);
        console.log(`GraphQL endpoint: http://localhost:${PORT}/graphql`);
    });
};
startServer().catch((err) => console.error(err));
