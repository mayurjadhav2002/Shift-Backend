import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";

export interface MyContext {
  userId?: string;
}

export const getUserContext = (authHeader?: string): MyContext => {
  if (!authHeader) return {};

  // Assuming format "Bearer <token>"
  const token = authHeader.replace("Bearer ", "");
  if (!token) return {};

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    return { userId: decoded.id };
  } catch (error) {
    console.error("JWT Verification Error:", error);
    return {};
  }
};
