import { loadFilesSync } from "@graphql-tools/load-files";
import { mergeTypeDefs } from "@graphql-tools/merge";
import path from "path";

// Automatically finds and merges all .graphql files in this directory
const typeDefsArray = loadFilesSync(__dirname, {
  extensions: ["graphql", ".graphql"],
});

export const typeDefs = mergeTypeDefs(typeDefsArray);
