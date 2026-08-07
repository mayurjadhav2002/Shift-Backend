"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUserContext = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";
const getUserContext = (authHeader) => {
    if (!authHeader)
        return {};
    // Assuming format "Bearer <token>"
    const token = authHeader.replace("Bearer ", "");
    if (!token)
        return {};
    try {
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        return { userId: decoded.id };
    }
    catch (error) {
        console.error("JWT Verification Error:", error);
        return {};
    }
};
exports.getUserContext = getUserContext;
