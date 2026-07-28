import jwt from "jsonwebtoken";
import redis from "./redis";

export function generateToken(user_data: {
  id: string;
  email: string;
  createdAt: Date;
}) {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is not defined");
  }
  const token = jwt.sign(user_data, process.env.JWT_SECRET, {
    expiresIn: "30d",
  });

  return token;
}

export function verifyToken(token: string) {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is not defined");
  }
  return jwt.verify(token, process.env.JWT_SECRET);
}

export async function isTokenValid(token: string) {
  const isInvalid = await redis.get(token);
  if (isInvalid) {
    return { isTokenValid: false, error: "Token is invalid" };
  }
  return { isTokenValid: true, error: null };
}

export async function inValidToken(token: string) {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is not defined");
  }
  return await redis.set(token, "invalid", "EX", 60 * 60 * 24);
}
