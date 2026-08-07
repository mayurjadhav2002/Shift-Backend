import { Server, Socket } from "socket.io";
import { Server as HttpServer } from "http";
import jwt from "jsonwebtoken";
import prisma from "../utils/prisma";
import redis from "../utils/redis";
const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";

let ioInstance: Server;

export const getIO = () => {
  if (!ioInstance) {
    throw new Error("Socket.io not initialized!");
  }
  return ioInstance;
};

export const setupSocketServer = (httpServer: HttpServer) => {
  const io = new Server(httpServer, {
    cors: {
      origin: "*", // Restrict in production
      methods: ["GET", "POST"],
    },
  });
  ioInstance = io;

  // Authentication Middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth.token || socket.handshake.headers.authorization;
    if (!token) {
      return next(new Error("Authentication error: No token provided"));
    }
    try {
      const decoded = jwt.verify(token.replace("Bearer ", ""), JWT_SECRET) as any;
      socket.data.userId = decoded.id;
      next();
    } catch (err) {
      return next(new Error("Authentication error: Invalid token"));
    }
  });

  io.on("connection", async (socket: Socket) => {
    const userId = socket.data.userId;
    console.log(`User connected: ${userId} on socket ${socket.id}`);

    // Join a personal room to receive targeted events
    socket.join(`user_${userId}`);

    // Add to Redis Set for this user
    const userKey = `online_user:${userId}`;
    await redis.sadd(userKey, socket.id);
    
    // Check if this is their first active socket connection
    const activeSocketsCount = await redis.scard(userKey);
    
    if (activeSocketsCount === 1) {
      // Notify matches that this user is online
      const matches = await prisma.match.findMany({
        where: {
          OR: [{ user1Id: userId }, { user2Id: userId }],
          isUnmatched: false,
        }
      });
      
      matches.forEach(match => {
        const otherId = match.user1Id === userId ? match.user2Id : match.user1Id;
        io.to(`user_${otherId}`).emit("user_online_status", { userId, isOnline: true });
      });
    }

    // Check online status of existing matches for this connecting user
    const userMatches = await prisma.match.findMany({
      where: {
        OR: [{ user1Id: userId }, { user2Id: userId }],
        isUnmatched: false,
      },
    });

    for (const match of userMatches) {
      const otherId = match.user1Id === userId ? match.user2Id : match.user1Id;
      const count = await redis.scard(`online_user:${otherId}`);
      if (count > 0) {
        socket.emit("user_online_status", { userId: otherId, isOnline: true });
      }
    }

    // Join Match Room
    socket.on("join_match", (matchId: string) => {
      socket.join(`match_${matchId}`);
      console.log(`User ${userId} joined room match_${matchId}`);
    });

    // Leave Match Room
    socket.on("leave_match", (matchId: string) => {
      socket.leave(`match_${matchId}`);
      console.log(`User ${userId} left room match_${matchId}`);
    });

    // Typing Indicators
    socket.on("typing_start", (matchId: string) => {
      socket.to(`match_${matchId}`).emit("typing_start", { userId, matchId });
    });

    socket.on("typing_end", (matchId: string) => {
      socket.to(`match_${matchId}`).emit("typing_end", { userId, matchId });
    });

    // Send Message
    socket.on("send_message", async (data: { matchId: string, content: string, imageUrl?: string, gifUrl?: string, tempId?: string, replyToId?: string, replyToContent?: string, replyToSenderName?: string, replyToType?: string }) => {
      try {
        const { matchId, content, imageUrl, gifUrl, tempId, replyToId, replyToContent, replyToSenderName, replyToType } = data;
        
        // Verify sender token balance if not premium
        const sender = await prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, isPremium: true, tokens: true }
        });

        if (!sender) {
          socket.emit("message_error", { tempId, error: "User not found" });
          return;
        }

        if (!sender.isPremium) {
          if ((sender.tokens ?? 0) < 10) {
            socket.emit("message_error", { tempId, error: "Insufficient tokens to send message. Upgrade to Premium for unlimited messaging!" });
            return;
          }
          await prisma.user.update({
            where: { id: userId },
            data: { tokens: { decrement: 10 } }
          });
        }

        // Save to DB
        const message = await prisma.message.create({
          data: {
            matchId,
            senderId: userId,
            content: content || "",
            imageUrl,
            gifUrl,
            replyToId,
            replyToContent,
            replyToSenderName,
            replyToType,
          },
          include: {
            sender: {
              select: {
                id: true,
                name: true,
                photos: true,
              }
            },
            match: {
              select: {
                user1Id: true,
                user2Id: true,
              }
            }
          }
        });

        // Update match updatedAt timestamp so recent conversations move to the top of the chat list
        await prisma.match.update({
          where: { id: matchId },
          data: { updatedAt: new Date() },
        });

        const targetRoom = `match_${matchId}`;
        const payload = { ...message, tempId };
        
        // Broadcast to the room and personal rooms so clients receive updates anywhere in the app
        io.to(targetRoom)
          .to(`user_${message.match.user1Id}`)
          .to(`user_${message.match.user2Id}`)
          .emit("receive_message", payload);
      } catch (error) {
        console.error("Error sending message via socket:", error);
        socket.emit("message_error", { error: "Failed to send message" });
      }
    });

    // Handle Check Online Status request
    socket.on("check_online_status", async (targetUserId: string) => {
      const activeCount = await redis.scard(`online_user:${targetUserId}`);
      const isOnline = activeCount > 0;
      socket.emit("user_online_status", { userId: targetUserId, isOnline });
    });

    socket.on("disconnect", async () => {
      console.log(`User disconnected: ${userId} from socket ${socket.id}`);
      
      const userKey = `online_user:${userId}`;
      await redis.srem(userKey, socket.id);
      
      const activeSocketsCount = await redis.scard(userKey);
      
      if (activeSocketsCount === 0) {
        // Notify matches that this user is offline
        const matches = await prisma.match.findMany({
            where: {
              OR: [{ user1Id: userId }, { user2Id: userId }],
              isUnmatched: false,
            }
          });
          
        matches.forEach(match => {
          const otherId = match.user1Id === userId ? match.user2Id : match.user1Id;
          io.to(`user_${otherId}`).emit("user_online_status", { userId, isOnline: false });
        });
      }
    });
  });

  return io;
};
