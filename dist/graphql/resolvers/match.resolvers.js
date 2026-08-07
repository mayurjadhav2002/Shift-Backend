"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.matchResolvers = void 0;
const prisma_1 = __importDefault(require("@/utils/prisma"));
const notifications_1 = require("@/utils/helpers/notifications");
exports.matchResolvers = {
    Query: {
        matches: async () => {
            return await prisma_1.default.match.findMany();
        },
        getUserMatches: async (_, args, context) => {
            return await prisma_1.default.match.findMany({
                where: {
                    OR: [{ user1Id: args.userId }, { user2Id: args.userId }],
                },
            });
        },
        getMessages: async (_, args, context) => {
            if (!context.userId) {
                throw new Error("Not Authenticated");
            }
            const user = await prisma_1.default.user.findUnique({
                where: { id: context.userId },
                select: { isPremium: true }
            });
            const limit = args.limit || 20;
            const messages = await prisma_1.default.message.findMany({
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
        getChats: async (_, __, context) => {
            if (!context.userId)
                throw new Error("Not Authenticated");
            const matches = await prisma_1.default.match.findMany({
                where: {
                    OR: [{ user1Id: context.userId }, { user2Id: context.userId }],
                    isUnmatched: false
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
        createMatch: async (_, args, context) => {
            if (!context.userId) {
                throw new Error("Not Authenticated");
            }
            return await prisma_1.default.match.create({
                data: {
                    user1Id: context.userId, // use JWT injected ID
                    user2Id: args.user2Id,
                },
            });
        },
        unmatch: async (_, args, context) => {
            if (!context.userId) {
                throw new Error("Not Authenticated");
            }
            return await prisma_1.default.match.update({
                where: { id: args.id },
                data: {
                    isUnmatched: true,
                    unmatchedAt: new Date(),
                },
            });
        },
        swipe: async (_, args, context) => {
            if (!context.userId) {
                throw new Error("Not Authenticated");
            }
            let tokenFieldToDeduct = "tokens";
            let cost = 0;
            if (args.type === "SUPERLIKE") {
                tokenFieldToDeduct = "superlikeTokens";
                cost = 1;
            }
            else if (args.type === "LIKE") {
                tokenFieldToDeduct = "tokens";
                cost = 10;
            }
            if (cost > 0) {
                const user = await prisma_1.default.user.findUnique({
                    where: { id: context.userId },
                    select: { tokens: true, superlikeTokens: true },
                });
                const currentBalance = tokenFieldToDeduct === "superlikeTokens" ? user?.superlikeTokens : user?.tokens;
                if (!user || currentBalance === undefined || currentBalance < cost) {
                    throw new Error("Insufficient tokens");
                }
                // Deduct tokens
                await prisma_1.default.user.update({
                    where: { id: context.userId },
                    data: { [tokenFieldToDeduct]: { decrement: cost } },
                });
            }
            // Create Swipe
            const swipe = await prisma_1.default.swipe.create({
                data: {
                    swiperId: context.userId,
                    swipedId: args.swipedId,
                    type: args.type,
                },
            });
            let match = null;
            // Check for mutual match
            if (args.type === "LIKE" || args.type === "SUPERLIKE") {
                const mutualSwipe = await prisma_1.default.swipe.findFirst({
                    where: {
                        swiperId: args.swipedId,
                        swipedId: context.userId,
                        type: { in: ["LIKE", "SUPERLIKE"] },
                    },
                });
                if (mutualSwipe) {
                    match = await prisma_1.default.match.create({
                        data: {
                            user1Id: context.userId,
                            user2Id: args.swipedId,
                        },
                    });
                    await (0, notifications_1.sendNotification)(context.userId, "New Match!", "You have a new match!");
                    await (0, notifications_1.sendNotification)(args.swipedId, "New Match!", "You have a new match!");
                    // Notify sockets
                    try {
                        const { getIO } = require("@/socket");
                        const io = getIO();
                        io.to(`user_${context.userId}`).emit("new_match", match);
                        io.to(`user_${args.swipedId}`).emit("new_match", match);
                    }
                    catch (e) {
                        console.error("Socket error on new match", e);
                    }
                }
            }
            const updatedUser = await prisma_1.default.user.findUnique({
                where: { id: context.userId }
            });
            return {
                match,
                user: updatedUser
            };
        },
        revealMessageStatus: async (_, args, context) => {
            if (!context.userId)
                throw new Error("Not Authenticated");
            const message = await prisma_1.default.message.findUnique({
                where: { id: args.messageId }
            });
            if (!message)
                throw new Error("Message not found");
            const user = await prisma_1.default.user.findUnique({
                where: { id: context.userId }
            });
            if (!user)
                throw new Error("User not found");
            if (!user.isPremium && !message.isRevealed) {
                if (user.tokens < 5) {
                    throw new Error("Insufficient tokens to reveal read receipt");
                }
                // Deduct 5 tokens and mark message as revealed in a single transaction
                await prisma_1.default.$transaction([
                    prisma_1.default.user.update({
                        where: { id: context.userId },
                        data: { tokens: { decrement: 5 } }
                    }),
                    prisma_1.default.message.update({
                        where: { id: args.messageId },
                        data: { isRevealed: true }
                    })
                ]);
            }
            else if (!message.isRevealed) {
                await prisma_1.default.message.update({
                    where: { id: args.messageId },
                    data: { isRevealed: true }
                });
            }
            return message.isRead || false;
        },
        markChatAsRead: async (_, args, context) => {
            if (!context.userId)
                throw new Error("Not Authenticated");
            const match = await prisma_1.default.match.findUnique({ where: { id: args.matchId } });
            if (!match || (match.user1Id !== context.userId && match.user2Id !== context.userId)) {
                throw new Error("Match not found or not authorized");
            }
            await prisma_1.default.message.updateMany({
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
        createDirectDM: async (_, args, context) => {
            if (!context.userId) {
                throw new Error("Not Authenticated");
            }
            const user = await prisma_1.default.user.findUnique({
                where: { id: context.userId },
                select: { dmTokens: true },
            });
            if (!user || user.dmTokens < 1) {
                throw new Error("Insufficient Direct Chat credits");
            }
            // Deduct 1 dmToken
            await prisma_1.default.user.update({
                where: { id: context.userId },
                data: { dmTokens: { decrement: 1 } },
            });
            // Check if match already exists
            let match = await prisma_1.default.match.findFirst({
                where: {
                    OR: [
                        { user1Id: context.userId, user2Id: args.targetUserId },
                        { user1Id: args.targetUserId, user2Id: context.userId },
                    ],
                },
            });
            if (!match) {
                match = await prisma_1.default.match.create({
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
            }
            else {
                match = await prisma_1.default.match.update({
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
            // Automatically create a Swipe so target user won't appear in feed again
            try {
                await prisma_1.default.swipe.upsert({
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
                        type: "SUPERLIKE",
                    },
                });
            }
            catch (err) {
                console.error("Error upserting swipe for Direct DM", err);
            }
            await (0, notifications_1.sendNotification)(args.targetUserId, "Direct Message!", "Someone connected with you through Direct DM!");
            try {
                const { getIO } = require("@/socket");
                const io = getIO();
                io.to(`user_${context.userId}`).emit("new_direct_dm", match);
                io.to(`user_${args.targetUserId}`).emit("new_direct_dm", match);
            }
            catch (e) {
                console.error("Socket error on direct DM", e);
            }
            const updatedUser = await prisma_1.default.user.findUnique({
                where: { id: context.userId },
            });
            return {
                match,
                user: updatedUser,
            };
        },
        acceptDirectDM: async (_, args, context) => {
            if (!context.userId)
                throw new Error("Not Authenticated");
            const match = await prisma_1.default.match.findUnique({ where: { id: args.matchId } });
            if (!match || (match.user1Id !== context.userId && match.user2Id !== context.userId)) {
                throw new Error("Match not found or not authorized");
            }
            const updatedMatch = await prisma_1.default.match.update({
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
            }
            catch (e) {
                console.error("Socket error on acceptDirectDM", e);
            }
            return updatedMatch;
        },
        rejectDirectDM: async (_, args, context) => {
            if (!context.userId)
                throw new Error("Not Authenticated");
            const match = await prisma_1.default.match.findUnique({ where: { id: args.matchId } });
            if (!match || (match.user1Id !== context.userId && match.user2Id !== context.userId)) {
                throw new Error("Match not found or not authorized");
            }
            await prisma_1.default.match.update({
                where: { id: args.matchId },
                data: {
                    isUnmatched: true,
                    unmatchedAt: new Date(),
                    dmStatus: "REJECTED",
                },
            });
            try {
                const { getIO } = require("@/socket");
                const io = getIO();
                io.to(`user_${match.user1Id}`).to(`user_${match.user2Id}`).emit("dm_updated", { matchId: args.matchId, dmStatus: "REJECTED", isUnmatched: true });
            }
            catch (e) {
                console.error("Socket error on rejectDirectDM", e);
            }
            return true;
        },
    },
};
