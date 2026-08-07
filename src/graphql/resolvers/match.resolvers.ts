import prisma from "@/utils/prisma";
import { MyContext } from "@/middleware/auth";
import { SwipeType } from "@prisma/client";
import { sendNotification } from "@/utils/helpers/notifications";

export const matchResolvers = {
  Query: {
    matches: async () => {
      return await prisma.match.findMany();
    },
    getUserMatches: async (
      _: any,
      args: { userId: string },
      context: MyContext,
    ) => {
      return await prisma.match.findMany({
        where: {
          OR: [{ user1Id: args.userId }, { user2Id: args.userId }],
        },
      });
    },
    getMessages: async (
      _: any,
      args: { matchId: string, limit?: number, cursor?: string },
      context: MyContext,
    ) => {
      if (!context.userId) {
        throw new Error("Not Authenticated");
      }
      
      const user = await prisma.user.findUnique({
        where: { id: context.userId },
        select: { isPremium: true }
      });
      
      const limit = args.limit || 20;

      const messages = await prisma.message.findMany({
        take: limit,
        skip: args.cursor ? 1 : 0,
        cursor: args.cursor ? { id: args.cursor } : undefined,
        where: { matchId: args.matchId },
        orderBy: { createdAt: "desc" }
      });

      return messages.map(msg => {
        if (msg.senderId !== context.userId) {
          return {
            ...msg,
            isRevealed: false
          };
        }
        
        const canSeeReceipt = user?.isPremium || msg.isRevealed;
        
        return {
          ...msg,
          isRead: canSeeReceipt ? msg.isRead : false,
          isRevealed: Boolean(msg.isRevealed)
        };
      });
    },
    getChats: async (_: any, __: any, context: MyContext) => {
      if (!context.userId) throw new Error("Not Authenticated");
      
      const matches = await prisma.match.findMany({
        where: {
          AND: [
            { OR: [{ user1Id: context.userId }, { user2Id: context.userId }] },
            { isUnmatched: false },
            {
              OR: [
                { dmStatus: null },
                { dmStatus: { not: "REJECTED" } },
              ],
            },
          ],
        },
        include: {
          user1: true,
          user2: true,
          messages: {
            orderBy: { createdAt: "desc" },
            take: 1
          },
          _count: {
            select: {
              messages: {
                where: {
                  senderId: { not: context.userId },
                  isRead: false
                }
              }
            }
          }
        },
        orderBy: { updatedAt: "desc" }
      });

      return matches.map(match => {
        const matchedUser = match.user1Id === context.userId ? match.user2 : match.user1;
        return {
          id: match.id,
          matchedUser,
          lastMessage: match.messages[0] || null,
          unreadCount: match._count.messages,
          updatedAt: match.updatedAt.toISOString(),
          isDirectDM: match.isDirectDM,
          dmStatus: match.dmStatus,
          dmSenderId: match.dmSenderId,
        };
      });
    },
  },
  Mutation: {
    createMatch: async (
      _: any,
      args: { user2Id: string },
      context: MyContext,
    ) => {
      if (!context.userId) {
        throw new Error("Not Authenticated");
      }

      return await prisma.match.create({
        data: {
          user1Id: context.userId, // use JWT injected ID
          user2Id: args.user2Id,
        },
      });
    },
    unmatch: async (_: any, args: { id: string }, context: MyContext) => {
      if (!context.userId) {
        throw new Error("Not Authenticated");
      }

      return await prisma.match.update({
        where: { id: args.id },
        data: {
          isUnmatched: true,
          unmatchedAt: new Date(),
        },
      });
    },
    swipe: async (_: any, args: { swipedId: string; type: string }, context: MyContext) => {
      if (!context.userId) {
        throw new Error("Not Authenticated");
      }

      let tokenFieldToDeduct = "tokens";
      let cost = 0;

      if (args.type === "SUPERLIKE") {
        tokenFieldToDeduct = "superlikeTokens";
        cost = 1;
      } else if (args.type === "LIKE") {
        tokenFieldToDeduct = "tokens";
        cost = 10;
      }

      if (cost > 0) {
        const user = await prisma.user.findUnique({
          where: { id: context.userId },
          select: { tokens: true, superlikeTokens: true },
        });

        const currentBalance = tokenFieldToDeduct === "superlikeTokens" ? user?.superlikeTokens : user?.tokens;

        if (!user || currentBalance === undefined || currentBalance < cost) {
          throw new Error("Insufficient tokens");
        }

        // Deduct tokens
        await prisma.user.update({
          where: { id: context.userId },
          data: { [tokenFieldToDeduct]: { decrement: cost } },
        });
      }

      // Create Swipe
      const swipe = await prisma.swipe.create({
        data: {
          swiperId: context.userId,
          swipedId: args.swipedId,
          type: args.type as SwipeType,
        },
      });

      let match = null;

      // Check for mutual match
      if (args.type === "LIKE" || args.type === "SUPERLIKE") {
        const mutualSwipe = await prisma.swipe.findFirst({
          where: {
            swiperId: args.swipedId,
            swipedId: context.userId,
            type: { in: ["LIKE", "SUPERLIKE"] as SwipeType[] },
          },
        });

        if (mutualSwipe) {
          match = await prisma.match.create({
            data: {
              user1Id: context.userId,
              user2Id: args.swipedId,
            },
          });
          
          await sendNotification(context.userId, "New Match!", "You have a new match!");
          await sendNotification(args.swipedId, "New Match!", "You have a new match!");

          // Notify sockets
          try {
            const { getIO } = require("@/socket");
            const io = getIO();
            io.to(`user_${context.userId}`).emit("new_match", match);
            io.to(`user_${args.swipedId}`).emit("new_match", match);
          } catch (e) {
            console.error("Socket error on new match", e);
          }
        }
      }

      const updatedUser = await prisma.user.findUnique({
        where: { id: context.userId }
      });

      return {
        match,
        user: updatedUser
      };
    },
    revealMessageStatus: async (_: any, args: { messageId: string }, context: MyContext) => {
      if (!context.userId) throw new Error("Not Authenticated");

      const message = await prisma.message.findUnique({
        where: { id: args.messageId }
      });

      if (!message) throw new Error("Message not found");

      const user = await prisma.user.findUnique({
        where: { id: context.userId }
      });

      if (!user) throw new Error("User not found");

      if (!user.isPremium && !message.isRevealed) {
        if (user.tokens < 5) {
          throw new Error("Insufficient tokens to reveal read receipt");
        }

        // Deduct 5 tokens and mark message as revealed in a single transaction
        await prisma.$transaction([
          prisma.user.update({
            where: { id: context.userId },
            data: { tokens: { decrement: 5 } }
          }),
          prisma.message.update({
            where: { id: args.messageId },
            data: { isRevealed: true }
          })
        ]);
      } else if (!message.isRevealed) {
        await prisma.message.update({
          where: { id: args.messageId },
          data: { isRevealed: true }
        });
      }

      return message.isRead || false;
    },
    markChatAsRead: async (_: any, args: { matchId: string }, context: MyContext) => {
      if (!context.userId) throw new Error("Not Authenticated");

      const match = await prisma.match.findUnique({ where: { id: args.matchId } });
      if (!match || (match.user1Id !== context.userId && match.user2Id !== context.userId)) {
        throw new Error("Match not found or not authorized");
      }

      await prisma.message.updateMany({
        where: {
          matchId: args.matchId,
          senderId: { not: context.userId },
          isRead: false
        },
        data: {
          isRead: true
        }
      });
      return true;
    },
    createDirectDM: async (_: any, args: { targetUserId: string; content?: string }, context: MyContext) => {
      if (!context.userId) {
        throw new Error("Not Authenticated");
      }

      const user = await prisma.user.findUnique({
        where: { id: context.userId },
        select: { dmTokens: true, tokens: true, isPremium: true },
      });

      if (!user || (!user.isPremium && user.dmTokens < 1 && user.tokens < 10)) {
        throw new Error("Insufficient chat tokens to send direct message");
      }

      // Deduct 1 dmToken or 10 chat tokens if not premium
      if (user.dmTokens >= 1) {
        await prisma.user.update({
          where: { id: context.userId },
          data: { dmTokens: { decrement: 1 } },
        });
      } else if (!user.isPremium && user.tokens >= 10) {
        await prisma.user.update({
          where: { id: context.userId },
          data: { tokens: { decrement: 10 } },
        });
      }

      // Check if match already exists
      let match = await prisma.match.findFirst({
        where: {
          OR: [
            { user1Id: context.userId, user2Id: args.targetUserId },
            { user1Id: args.targetUserId, user2Id: context.userId },
          ],
        },
      });

      if (!match) {
        match = await prisma.match.create({
          data: {
            user1Id: context.userId,
            user2Id: args.targetUserId,
            isDirectDM: true,
            dmStatus: "PENDING",
            dmSenderId: context.userId,
            isUnmatched: false,
            unmatchedAt: null,
          },
        });
      } else {
        match = await prisma.match.update({
          where: { id: match.id },
          data: {
            isDirectDM: true,
            dmStatus: "PENDING",
            dmSenderId: context.userId,
            isUnmatched: false,
            unmatchedAt: null,
            updatedAt: new Date(),
          },
        });
      }

      // Create initial text message if provided
      let initialMessage = null;
      if (args.content && args.content.trim()) {
        initialMessage = await prisma.message.create({
          data: {
            matchId: match.id,
            senderId: context.userId,
            content: args.content.trim(),
            isRead: false,
          },
        });
      }

      // Automatically create a Swipe so target user won't appear in feed again
      try {
        await prisma.swipe.upsert({
          where: {
            swiperId_swipedId: {
              swiperId: context.userId,
              swipedId: args.targetUserId,
            },
          },
          update: {},
          create: {
            swiperId: context.userId,
            swipedId: args.targetUserId,
            type: "SUPERLIKE" as SwipeType,
          },
        });
      } catch (err) {
        console.error("Error upserting swipe for Direct DM", err);
      }

      await sendNotification(args.targetUserId, "New Direct Message! 💌", args.content ? `${args.content}` : "Someone sent you a direct chat request!");

      try {
        const { getIO } = require("@/socket");
        const io = getIO();
        io.to(`user_${context.userId}`).emit("new_direct_dm", match);
        io.to(`user_${args.targetUserId}`).emit("new_direct_dm", match);
        if (initialMessage) {
          io.to(`user_${context.userId}`).emit("receive_message", initialMessage);
          io.to(`user_${args.targetUserId}`).emit("receive_message", initialMessage);
          io.to(`user_${context.userId}`).emit("new_message", initialMessage);
          io.to(`user_${args.targetUserId}`).emit("new_message", initialMessage);
        }
      } catch (e) {
        console.error("Socket error on direct DM", e);
      }

      const updatedUser = await prisma.user.findUnique({
        where: { id: context.userId },
      });

      return {
        match,
        user: updatedUser,
      };
    },
    acceptDirectDM: async (_: any, args: { matchId: string }, context: MyContext) => {
      if (!context.userId) throw new Error("Not Authenticated");

      const match = await prisma.match.findUnique({ where: { id: args.matchId } });
      if (!match || (match.user1Id !== context.userId && match.user2Id !== context.userId)) {
        throw new Error("Match not found or not authorized");
      }

      const updatedMatch = await prisma.match.update({
        where: { id: args.matchId },
        data: {
          dmStatus: "ACCEPTED",
          updatedAt: new Date(),
        },
      });

      try {
        const { getIO } = require("@/socket");
        const io = getIO();
        io.to(`user_${match.user1Id}`).to(`user_${match.user2Id}`).emit("dm_updated", { matchId: args.matchId, dmStatus: "ACCEPTED" });
      } catch (e) {
        console.error("Socket error on acceptDirectDM", e);
      }

      return updatedMatch;
    },
    rejectDirectDM: async (_: any, args: { matchId: string }, context: MyContext) => {
      if (!context.userId) throw new Error("Not Authenticated");

      const match = await prisma.match.findUnique({ where: { id: args.matchId } });
      if (!match || (match.user1Id !== context.userId && match.user2Id !== context.userId)) {
        throw new Error("Match not found or not authorized");
      }

      await prisma.match.update({
        where: { id: args.matchId },
        data: {
          isUnmatched: true,
          unmatchedAt: new Date(),
          dmStatus: "REJECTED",
        },
      });

      // Delete all messages associated with this match upon rejection
      await prisma.message.deleteMany({
        where: { matchId: args.matchId },
      });

      try {
        const { getIO } = require("@/socket");
        const io = getIO();
        io.to(`user_${match.user1Id}`).to(`user_${match.user2Id}`).emit("dm_updated", { matchId: args.matchId, dmStatus: "REJECTED", isUnmatched: true });
      } catch (e) {
        console.error("Socket error on rejectDirectDM", e);
      }

      return true;
    },
  },
};
