"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateToken = generateToken;
exports.verifyToken = verifyToken;
exports.isTokenValid = isTokenValid;
exports.inValidToken = inValidToken;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const redis_1 = __importDefault(require("./redis"));
function generateToken(user_data) {
    if (!process.env.JWT_SECRET) {
        throw new Error("JWT_SECRET is not defined");
    }
    const token = jsonwebtoken_1.default.sign(user_data, process.env.JWT_SECRET, {
        expiresIn: "30d",
    });
    return token;
}
function verifyToken(token) {
    if (!process.env.JWT_SECRET) {
        throw new Error("JWT_SECRET is not defined");
    }
    return jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET);
}
async function isTokenValid(token) {
    const isInvalid = await redis_1.default.get(token);
    if (isInvalid) {
        return { isTokenValid: false, error: "Token is invalid" };
    }
    return { isTokenValid: true, error: null };
}
async function inValidToken(token) {
    if (!process.env.JWT_SECRET) {
        throw new Error("JWT_SECRET is not defined");
    }
    return await redis_1.default.set(token, "invalid", "EX", 60 * 60 * 24);
}
