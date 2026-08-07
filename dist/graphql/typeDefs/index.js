"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.typeDefs = void 0;
const load_files_1 = require("@graphql-tools/load-files");
const merge_1 = require("@graphql-tools/merge");
// Automatically finds and merges all .graphql files in this directory
const typeDefsArray = (0, load_files_1.loadFilesSync)(__dirname, {
    extensions: ["graphql", ".graphql"],
});
exports.typeDefs = (0, merge_1.mergeTypeDefs)(typeDefsArray);
