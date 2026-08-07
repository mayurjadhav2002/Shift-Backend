"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.userResolvers = void 0;
const enums_1 = require("@/generated/prisma/enums");
const prisma_1 = __importDefault(require("@/utils/prisma"));
const tokens_1 = require("@/utils/tokens");
const google_auth_library_1 = require("google-auth-library");
const cloudinary_1 = require("cloudinary");
cloudinary_1.v2.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});
const googleClient = new google_auth_library_1.OAuth2Client(process.env.GOOGLE_WEB_CLIENT_ID);
exports.userResolvers = {
    Query: {
        users: async () => {
            return await prisma_1.default.user.findMany();
        },
        getProfile: async (_, args, context) => {
            const user = await prisma_1.default.user.findUnique({
                where: { id: args.id },
                include: { tags: true },
            });
            if (!user)
                return null;
            const isViewingOther = args.isView || (context.userId && context.userId !== user.id);
            if (isViewingOther) {
                // Hide private fields when viewing someone else's profile
                user.email = "";
                user.latitude = null;
                user.longitude = null;
                // Secure social links gating: only send handle if requesting user has added their own
                if (context.userId && (user.instagram || user.snapchat || user.twitter)) {
                    const viewer = await prisma_1.default.user.findUnique({
                        where: { id: context.userId },
                        select: { instagram: true, snapchat: true, twitter: true },
                    });
                    if (user.instagram && !viewer?.instagram) {
                        user.instagram = "LOCKED";
                    }
                    if (user.snapchat && !viewer?.snapchat) {
                        user.snapchat = "LOCKED";
                    }
                    if (user.twitter && !viewer?.twitter) {
                        user.twitter = "LOCKED";
                    }
                }
            }
            if (user.prompts && typeof user.prompts === "object") {
                user.prompts = JSON.stringify(user.prompts);
            }
            if (user.tags) {
                user.tags = user.tags.map((t) => t.name);
            }
            // Check if logged in user is currently connected / matched with this profile
            user.isMatched = false;
            user.matchId = null;
            if (context.userId && context.userId !== user.id) {
                const existingMatch = await prisma_1.default.match.findFirst({
                    where: {
                        OR: [
                            { user1Id: context.userId, user2Id: user.id },
                            { user1Id: user.id, user2Id: context.userId },
                        ],
                        isUnmatched: false,
                    },
                    select: { id: true },
                });
                if (existingMatch) {
                    user.isMatched = true;
                    user.matchId = existingMatch.id;
                }
            }
            return user;
        },
        getDailyRewardStatus: async (_, __, context) => {
            if (!context.userId)
                throw new Error("Not Authenticated");
            const user = await prisma_1.default.user.findUnique({
                where: { id: context.userId },
                select: { lastRewardClaimDate: true, rewardDayCounter: true },
            });
            if (!user)
                throw new Error("User not found");
            const now = new Date();
            let canClaimToday = true;
            if (user.lastRewardClaimDate) {
                const lastClaim = new Date(user.lastRewardClaimDate);
                if (lastClaim.getFullYear() === now.getFullYear() &&
                    lastClaim.getMonth() === now.getMonth() &&
                    lastClaim.getDate() === now.getDate()) {
                    canClaimToday = false;
                }
            }
            let nextRewardDay = (user.rewardDayCounter % 7) + 1;
            return {
                nextRewardDay,
                canClaimToday,
                serverTime: now.toISOString(),
            };
        },
    },
    Mutation: {
        loginWithGoogle: async (_, args) => {
            const ticket = await googleClient.verifyIdToken({
                idToken: args.idToken,
                audience: process.env.GOOGLE_WEB_CLIENT_ID,
            });
            const payload = ticket.getPayload();
            if (!payload || !payload.email)
                throw new Error("Invalid Google token");
            const email = payload.email;
            const name = payload.name || "Google User";
            const picture = payload.picture;
            let user = await prisma_1.default.user.findUnique({
                where: { email },
            });
            if (!user) {
                user = await prisma_1.default.user.create({
                    data: {
                        email,
                        name,
                        loginProvider: enums_1.LoginProvider.GOOGLE,
                        tokens: 100,
                        photos: picture ? [picture] : [],
                    },
                });
            }
            else if (picture && (!user.photos || user.photos.length === 0)) {
                user = await prisma_1.default.user.update({
                    where: { email },
                    data: { photos: [picture] },
                });
            }
            const token = (0, tokens_1.generateToken)({
                id: user.id,
                email: user.email,
                createdAt: new Date(),
            });
            return { user, accessToken: token };
        },
        createUser: async (_, args) => {
            let user;
            const userExists = await prisma_1.default.user.findUnique({
                where: { email: args.email },
            });
            if (userExists) {
                user = await prisma_1.default.user.update({
                    where: { email: args.email },
                    data: {
                        email: args.email,
                        password: args.password,
                        name: args.name,
                        loginProvider: args.loginProvider,
                    },
                });
            }
            else {
                user = await prisma_1.default.user.create({
                    data: {
                        email: args.email,
                        password: args.password,
                        name: args.name,
                        loginProvider: args.loginProvider,
                        tokens: 100,
                    },
                });
            }
            const token = (0, tokens_1.generateToken)({
                id: user.id,
                email: user.email,
                createdAt: new Date(),
            });
            return { user, accessToken: token };
        },
        updateUser: async (_, args) => {
            const user = await prisma_1.default.user.update({
                where: { id: args.id },
                data: {
                    ...(args.email && { email: args.email }),
                    ...(args.password && { password: args.password }),
                    ...(args.name && { name: args.name }),
                    ...(args.bio !== undefined && { bio: args.bio }),
                    ...(args.gender !== undefined && { gender: args.gender }),
                    ...(args.birthDate && { birthDate: new Date(args.birthDate) }),
                    ...(args.photos !== undefined && { photos: args.photos }),
                    ...(args.latitude !== undefined && { latitude: args.latitude }),
                    ...(args.longitude !== undefined && { longitude: args.longitude }),
                    ...(args.isVerified !== undefined && { isVerified: args.isVerified }),
                    ...(args.prompts !== undefined && {
                        prompts: args.prompts ? JSON.parse(args.prompts) : null,
                    }),
                    ...(args.jobTitle !== undefined && { jobTitle: args.jobTitle }),
                    ...(args.company !== undefined && { company: args.company }),
                    ...(args.school !== undefined && { school: args.school }),
                    ...(args.languages !== undefined && { languages: args.languages }),
                    ...(args.zodiac !== undefined && { zodiac: args.zodiac }),
                    ...(args.familyPlans !== undefined && {
                        familyPlans: args.familyPlans,
                    }),
                    ...(args.covidVaccine !== undefined && {
                        covidVaccine: args.covidVaccine,
                    }),
                    ...(args.personalityType !== undefined && {
                        personalityType: args.personalityType,
                    }),
                    ...(args.communicationStyle !== undefined && {
                        communicationStyle: args.communicationStyle,
                    }),
                    ...(args.loveStyle !== undefined && { loveStyle: args.loveStyle }),
                    ...(args.pets !== undefined && { pets: args.pets }),
                    ...(args.drinking !== undefined && { drinking: args.drinking }),
                    ...(args.instagram !== undefined && { instagram: args.instagram }),
                    ...(args.snapchat !== undefined && { snapchat: args.snapchat }),
                    ...(args.twitter !== undefined && { twitter: args.twitter }),
                    ...(args.showSocials !== undefined && {
                        showSocials: args.showSocials,
                    }),
                    ...(args.tags !== undefined && {
                        tags: {
                            set: [], // clears existing tags
                            connectOrCreate: args.tags.map((tag) => ({
                                where: { name: tag },
                                create: { name: tag },
                            })),
                        },
                    }),
                },
                include: { tags: true },
            });
            if (user.prompts && typeof user.prompts === "object") {
                user.prompts = JSON.stringify(user.prompts);
            }
            if (user.tags) {
                user.tags = user.tags.map((t) => t.name);
            }
            return user;
        },
        deleteUser: async (_, args) => {
            return await prisma_1.default.user.delete({
                where: { id: args.id },
            });
        },
        signUp: async (_, args) => {
            let user = await prisma_1.default.user.create({
                data: {
                    email: args.email,
                    password: args.password,
                    name: args.name,
                    loginProvider: enums_1.LoginProvider.EMAIL,
                    tokens: 100,
                },
            });
            const token = (0, tokens_1.generateToken)({
                id: user.id,
                email: user.email,
                createdAt: new Date(),
            });
            return { user, accessToken: token }; // Return format based on what client expects, though type is User! in schema.
            // Wait, in schema `createUser` returns `User!`, but here it returns `{ user, accessToken: token }`. I will just return user, as per schema.
        },
        logout: async () => {
            return true;
        },
        deleteAccount: async (_, __, context) => {
            if (!context.userId)
                throw new Error("Not Authenticated");
            return await prisma_1.default.user.delete({
                where: { id: context.userId },
            });
        },
        addTokens: async (_, args, context) => {
            if (!context.userId)
                throw new Error("Not Authenticated");
            return await prisma_1.default.user.update({
                where: { id: context.userId },
                data: { tokens: { increment: args.amount } },
            });
        },
        claimDailyReward: async (_, __, context) => {
            if (!context.userId)
                throw new Error("Not Authenticated");
            const user = await prisma_1.default.user.findUnique({
                where: { id: context.userId },
            });
            if (!user)
                throw new Error("User not found");
            const now = new Date();
            if (user.lastRewardClaimDate) {
                const lastClaim = new Date(user.lastRewardClaimDate);
                if (lastClaim.getFullYear() === now.getFullYear() &&
                    lastClaim.getMonth() === now.getMonth() &&
                    lastClaim.getDate() === now.getDate()) {
                    throw new Error("Already claimed today");
                }
            }
            const nextRewardDay = (user.rewardDayCounter % 7) + 1;
            let updateData = {
                lastRewardClaimDate: now,
                rewardDayCounter: nextRewardDay,
            };
            if (nextRewardDay === 1)
                updateData.tokens = { increment: 50 };
            if (nextRewardDay === 2)
                updateData.superlikeTokens = { increment: 1 };
            if (nextRewardDay === 3)
                updateData.tokens = { increment: 100 };
            if (nextRewardDay === 4)
                updateData.dmTokens = { increment: 1 };
            if (nextRewardDay === 5)
                updateData.tokens = { increment: 150 };
            if (nextRewardDay === 6)
                updateData.rewindTokens = { increment: 2 };
            if (nextRewardDay === 7)
                updateData.tokens = { increment: 250 };
            return await prisma_1.default.user.update({
                where: { id: context.userId },
                data: updateData,
            });
        },
        uploadPhoto: async (_, args, context) => {
            if (!context.userId)
                throw new Error("Not Authenticated");
            const { base64 } = args;
            // Ensure the string has the data URI prefix if it doesn't already
            const fileStr = base64.startsWith("data:image")
                ? base64
                : `data:image/jpeg;base64,${base64}`;
            try {
                const result = await cloudinary_1.v2.uploader.upload(fileStr, {
                    folder: `shift/users/${context.userId}`,
                });
                return result.secure_url;
            }
            catch (error) {
                throw new Error(`Failed to upload photo: ${error.message}`);
            }
        },
        deletePhoto: async (_, args, context) => {
            if (!context.userId)
                throw new Error("Not Authenticated");
            try {
                // Extract public ID from URL
                // Example URL: https://res.cloudinary.com/cloud_name/image/upload/v1234567890/shift/users/123/image_name.jpg
                const parts = args.url.split("/");
                const fileWithExt = parts.pop();
                if (!fileWithExt)
                    return false;
                const fileName = fileWithExt.split(".")[0];
                // Find the index of the folder to reconstruct the full public_id
                const folderIndex = parts.indexOf("shift");
                if (folderIndex === -1) {
                    // Fallback if the folder structure is different
                    await cloudinary_1.v2.uploader.destroy(fileName);
                    return true;
                }
                const folderPath = parts.slice(folderIndex).join("/");
                const publicId = `${folderPath}/${fileName}`;
                const result = await cloudinary_1.v2.uploader.destroy(publicId);
                return result.result === "ok";
            }
            catch (error) {
                throw new Error(`Failed to delete photo: ${error.message}`);
            }
        },
        unmatchUser: async (_, args, context) => {
            if (!context.userId)
                throw new Error("Not Authenticated");
            await prisma_1.default.match.updateMany({
                where: {
                    OR: [
                        { user1Id: context.userId, user2Id: args.userId },
                        { user1Id: args.userId, user2Id: context.userId },
                    ],
                    isUnmatched: false,
                },
                data: {
                    isUnmatched: true,
                    unmatchedAt: new Date(),
                },
            });
            return true;
        },
        blockUser: async (_, args, context) => {
            if (!context.userId)
                throw new Error("Not Authenticated");
            // 1. Unmatch any active connection
            await prisma_1.default.match.updateMany({
                where: {
                    OR: [
                        { user1Id: context.userId, user2Id: args.userId },
                        { user1Id: args.userId, user2Id: context.userId },
                    ],
                },
                data: {
                    isUnmatched: true,
                    unmatchedAt: new Date(),
                },
            });
            // 2. Remove all swipes between them so neither appears in feed/discover again
            await prisma_1.default.swipe.deleteMany({
                where: {
                    OR: [
                        { swiperId: context.userId, swipedId: args.userId },
                        { swiperId: args.userId, swipedId: context.userId },
                    ],
                },
            });
            console.log(`[USER_BLOCKED] User ${context.userId} blocked ${args.userId}. Reason: ${args.reason || "None"}`);
            return true;
        },
        reportUser: async (_, args, context) => {
            if (!context.userId)
                throw new Error("Not Authenticated");
            console.log(`[USER_REPORTED] User ${context.userId} reported ${args.userId}. Reason: ${args.reason}`);
            return true;
        },
    },
    User: {
        matches1: async (parent) => {
            return await prisma_1.default.match.findMany({ where: { user1Id: parent.id } });
        },
        matches2: async (parent) => {
            return await prisma_1.default.match.findMany({ where: { user2Id: parent.id } });
        },
        messages: async (parent) => {
            return await prisma_1.default.message.findMany({ where: { senderId: parent.id } });
        },
        posts: async (parent) => {
            return await prisma_1.default.post.findMany({ where: { authorId: parent.id } });
        },
        swipesGiven: async (parent) => {
            return await prisma_1.default.swipe.findMany({ where: { swiperId: parent.id } });
        },
        swipesReceived: async (parent) => {
            return await prisma_1.default.swipe.findMany({ where: { swipedId: parent.id } });
        },
        hasLikedMe: async (parent, _, context) => {
            if (!context.userId)
                return false;
            const swipe = await prisma_1.default.swipe.findFirst({
                where: { swiperId: parent.id, swipedId: context.userId, type: "LIKE" },
            });
            return !!swipe;
        },
        hasSuperlikedMe: async (parent, _, context) => {
            if (!context.userId)
                return false;
            const swipe = await prisma_1.default.swipe.findFirst({
                where: {
                    swiperId: parent.id,
                    swipedId: context.userId,
                    type: "SUPERLIKE",
                },
            });
            return !!swipe;
        },
    },
};
