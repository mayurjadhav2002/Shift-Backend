import { loadFilesSync } from "@graphql-tools/load-files";
import { mergeResolvers } from "@graphql-tools/merge";
import path from "path";

const resolversArray = loadFilesSync(path.join(__dirname, "./**/*.resolvers.*"));

// Unwrap named exports (e.g., { userResolvers: { Query: ... } } -> { Query: ... })
const unwrappedResolvers = resolversArray.map((resolverModule) => {
  return Object.values(resolverModule)[0] || resolverModule;
});

export const resolvers = mergeResolvers(unwrappedResolvers);
