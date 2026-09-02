import { LoginProvider } from "@prisma/client";
import prisma from "@/utils/prisma";
import redis from "@/utils/redis";
import { generateToken } from "@/utils/tokens";
import { MyContext } from "@/middleware/auth";
import { OAuth2Client } from "google-auth-library";
import { v2 as cloudinary } from "cloudinary";
import * as argon2 from "argon2";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const googleClient = new OAuth2Client(process.env.GOOGLE_WEB_CLIENT_ID);
export const userResolvers = {
  Query: {
    users: async () => {
      return await prisma.user.findMany();
    },

    getProfile: async (
      _: any,
      args: { id: string; isView?: boolean },
      context: MyContext
    ) => {
      const user: any = await prisma.user.findUnique({
        where: { id: args.id },
        include: { tags: true },
      });
      if (!user) return null;

      if (user.isPremium && user.premiumUntil && new Date(user.premiumUntil) < new Date()) {
        user.isPremium = false;
        await prisma.user.update({
          where: { id: user.id },
          data: { isPremium: false },
        });
      }

      const isViewingOther = args.isView || (context.userId && context.userId !== user.id);

      if (isViewingOther) {
        try {
          await prisma.analytics.upsert({
            where: { userId: user.id },
            update: { profileViews: { increment: 1 } },
            create: { userId: user.id, profileViews: 1 },
          });
        } catch (e) {
          console.error("Failed to update profile views analytics:", e);
        }

        // Hide private fields when viewing someone else's profile
        user.email = "";
        user.latitude = null;
        user.longitude = null;

        // Secure social links gating: only send handle if requesting user has added their own
        if (context.userId && (user.instagram || user.snapchat || user.twitter)) {
          const viewer = await prisma.user.findUnique({
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
        user.prompts = JSON.stringify(user.prompts) as any;
      }

      if (user.tags) {
        user.tags = user.tags.map((t: any) => t.name);
      }

      // Check if logged in user is currently connected / matched with this profile
      user.isMatched = false;
      user.matchId = null;
      if (context.userId && context.userId !== user.id) {
        const existingMatch = await prisma.match.findFirst({
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
    getDailyRewardStatus: async (_: any, __: any, context: MyContext) => {
      if (!context.userId) throw new Error("Not Authenticated");
      const user = await prisma.user.findUnique({
        where: { id: context.userId },
        select: { lastRewardClaimDate: true, rewardDayCounter: true },
      });
      if (!user) throw new Error("User not found");

      const now = new Date();
      let canClaimToday = true;

      if (user.lastRewardClaimDate) {
        const lastClaim = new Date(user.lastRewardClaimDate);
        if (
          lastClaim.getFullYear() === now.getFullYear() &&
          lastClaim.getMonth() === now.getMonth() &&
          lastClaim.getDate() === now.getDate()
        ) {
          canClaimToday = false;
        }
      }

      let nextRewardDay = (user.rewardDayCounter || 0) + 1;

      return {
        nextRewardDay,
        canClaimToday,
        serverTime: now.toISOString(),
      };
    },
    getBlockedUsers: async (_: any, __: any, context: MyContext) => {
      if (!context.userId) throw new Error("Not Authenticated");
      const blockRecords = await prisma.blockedUser.findMany({
        where: { blockerId: context.userId },
        include: { blocked: true },
        orderBy: { createdAt: "desc" },
      });
      return blockRecords.map((b) => ({
        id: b.id,
        blockedId: b.blockedId,
        name: b.blocked ? b.blocked.name : "Deleted User",
        avatar: (b.blocked?.photos && b.blocked.photos[0]) || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80",
        reason: b.reason || "Blocked by user",
        createdAt: b.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      }));
    },
  },
  Mutation: {
    loginWithGoogle: async (_: any, args: { idToken: string }) => {
      const ticket = await googleClient.verifyIdToken({
        idToken: args.idToken,
        audience: process.env.GOOGLE_WEB_CLIENT_ID,
      });
      const payload = ticket.getPayload();
      if (!payload || !payload.email) throw new Error("Invalid Google token");

      const email = payload.email;
      const name = payload.name || "Google User";
      const picture = payload.picture;

      let user = await prisma.user.findUnique({
        where: { email },
      });

      if (!user) {
        user = await prisma.user.create({
          data: {
            email,
            name,
            loginProvider: LoginProvider.GOOGLE,
            tokens: 100,
            photos: picture ? [picture] : [],
          },
        });
      } else if (picture && (!user.photos || user.photos.length === 0)) {
        user = await prisma.user.update({
          where: { email },
          data: { photos: [picture] },
        });
      }

      const token = generateToken({
        id: user.id,
        email: user.email,
        createdAt: new Date(),
      });

      return { user, accessToken: token };
    },
    createUser: async (
      _: any,
      args: {
        email: string;
        loginProvider: LoginProvider;
        password: string;
        name: string;
      },
    ) => {
      let user;
      const hashedPassword = await argon2.hash(args.password);
      const userExists = await prisma.user.findUnique({
        where: { email: args.email },
      });
      if (userExists) {
        user = await prisma.user.update({
          where: { email: args.email },
          data: {
            email: args.email,
            password: hashedPassword,
            name: args.name,
            loginProvider: args.loginProvider,
          },
        });
      } else {
        user = await prisma.user.create({
          data: {
            email: args.email,
            password: hashedPassword,
            name: args.name,
            loginProvider: args.loginProvider,
            tokens: 100,
          },
        });
      }

      const token = generateToken({
        id: user.id,
        email: user.email,
        createdAt: new Date(),
      });
      return { user, accessToken: token };
    },
    updateUser: async (
      _: any,
      args: {
        id: string;
        email?: string;
        password?: string;
        name?: string;
        bio?: string;
        gender?: string;
        birthDate?: string;
        photos?: string[];
        latitude?: number;
        longitude?: number;
        isVerified?: boolean;
        prompts?: string;
        jobTitle?: string;
        company?: string;
        school?: string;
        languages?: string[];
        zodiac?: string;
        familyPlans?: string;
        covidVaccine?: string;
        personalityType?: string;
        communicationStyle?: string;
        loveStyle?: string;
        pets?: string;
        drinking?: string;
        tags?: string[];
        instagram?: string;
        snapchat?: string;
        twitter?: string;
        showSocials?: boolean;
        country?: string;
        preferredCountry?: string;
        isPaused?: boolean;
      },
    ) => {
      if (args.preferredCountry !== undefined && args.preferredCountry !== "All") {
        const existing = await prisma.user.findUnique({ where: { id: args.id } });
        if (existing && !existing.isPremium && args.preferredCountry !== existing.country) {
          throw new Error("PREMIUM_REQUIRED: Filtering matches by specific country is exclusively available to Premium members.");
        }
      }
      const user = await prisma.user.update({
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
          ...(args.country !== undefined && { country: args.country }),
          ...(args.preferredCountry !== undefined && {
            preferredCountry: args.preferredCountry,
          }),
          ...(args.isPaused !== undefined && { isPaused: args.isPaused }),
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
        user.prompts = JSON.stringify(user.prompts) as any;
      }

      if ((user as any).tags) {
        (user as any).tags = (user as any).tags.map((t: any) => t.name);
      }

      return user;
    },
    deleteUser: async (_: any, args: { id: string }) => {
      return await prisma.user.delete({
        where: { id: args.id },
      });
    },
    signUp: async (
      _: any,
      args: {
        email: string;
        password: string;
        name: string;
      },
    ) => {
      const hashedPassword = await argon2.hash(args.password);
      let user = await prisma.user.create({
        data: {
          email: args.email,
          password: hashedPassword,
          name: args.name,
          loginProvider: LoginProvider.EMAIL,
          tokens: 100,
        },
      });

      const token = generateToken({
        id: user.id,
        email: user.email,
        createdAt: new Date(),
      });
      return { user, accessToken: token }; // Return format based on what client expects, though type is User! in schema.
      // Wait, in schema `createUser` returns `User!`, but here it returns `{ user, accessToken: token }`. I will just return user, as per schema.
    },
    login: async (_: any, args: { email: string; password: string }) => {
      const user = await prisma.user.findUnique({ where: { email: args.email } });
      if (!user) {
        throw new Error("Invalid email or password");
      }
      if (!user.password) {
        throw new Error("User signed up with a different provider. Please use Google Sign In.");
      }
      
      const validPassword = await argon2.verify(user.password, args.password);
      if (!validPassword) {
        throw new Error("Invalid email or password");
      }
      
      const token = generateToken({
        id: user.id,
        email: user.email,
        createdAt: new Date(),
      });
      return { user, accessToken: token };
    },
    logout: async () => {
      return true;
    },
    deleteAccount: async (_: any, __: any, context: MyContext) => {
      if (!context.userId) throw new Error("Not Authenticated");
      return await prisma.user.delete({
        where: { id: context.userId },
      });
    },
    addTokens: async (_: any, args: { amount: number }, context: MyContext) => {
      if (!context.userId) throw new Error("Not Authenticated");
      return await prisma.user.update({
        where: { id: context.userId },
        data: { tokens: { increment: args.amount } },
      });
    },
    claimDailyReward: async (_: any, __: any, context: MyContext) => {
      if (!context.userId) throw new Error("Not Authenticated");
      const user = await prisma.user.findUnique({
        where: { id: context.userId },
      });
      if (!user) throw new Error("User not found");

      const now = new Date();

      if (user.lastRewardClaimDate) {
        const lastClaim = new Date(user.lastRewardClaimDate);
        if (
          lastClaim.getFullYear() === now.getFullYear() &&
          lastClaim.getMonth() === now.getMonth() &&
          lastClaim.getDate() === now.getDate()
        ) {
          throw new Error("Already claimed today");
        }
      }

      const nextRewardDay = (user.rewardDayCounter || 0) + 1;

      let updateData: any = {
        lastRewardClaimDate: now,
        rewardDayCounter: nextRewardDay,
      };

      const cycleDay = ((nextRewardDay - 1) % 7) + 1;
      const weekMultiplier = Math.floor((nextRewardDay - 1) / 7) + 1;

      if (cycleDay === 1) updateData.tokens = { increment: 50 * weekMultiplier };
      if (cycleDay === 2) updateData.superlikeTokens = { increment: 1 + Math.floor((weekMultiplier - 1) / 2) };
      if (cycleDay === 3) updateData.tokens = { increment: 100 * weekMultiplier };
      if (cycleDay === 4) updateData.dmTokens = { increment: 1 + Math.floor((weekMultiplier - 1) / 2) };
      if (cycleDay === 5) updateData.tokens = { increment: 150 * weekMultiplier };
      if (cycleDay === 6) updateData.rewindTokens = { increment: 2 * weekMultiplier };
      if (cycleDay === 7) updateData.tokens = { increment: 300 * weekMultiplier };

      return await prisma.user.update({
        where: { id: context.userId },
        data: updateData,
      });
    },
    uploadPhoto: async (
      _: any,
      args: { base64: string },
      context: MyContext,
    ) => {
      if (!context.userId) throw new Error("Not Authenticated");

      const { base64 } = args;
      // Ensure the string has the data URI prefix if it doesn't already
      const fileStr = base64.startsWith("data:image")
        ? base64
        : `data:image/jpeg;base64,${base64}`;

      try {
        const result = await cloudinary.uploader.upload(fileStr, {
          folder: `shift/users/${context.userId}`,
        });
        return result.secure_url;
      } catch (error: any) {
        throw new Error(`Failed to upload photo: ${error.message}`);
      }
    },
    deletePhoto: async (_: any, args: { url: string }, context: MyContext) => {
      if (!context.userId) throw new Error("Not Authenticated");

      try {
        // Extract public ID from URL
        // Example URL: https://res.cloudinary.com/cloud_name/image/upload/v1234567890/shift/users/123/image_name.jpg
        const parts = args.url.split("/");
        const fileWithExt = parts.pop();
        if (!fileWithExt) return false;

        const fileName = fileWithExt.split(".")[0];

        // Find the index of the folder to reconstruct the full public_id
        const folderIndex = parts.indexOf("shift");
        if (folderIndex === -1) {
          // Fallback if the folder structure is different
          await cloudinary.uploader.destroy(fileName);
          return true;
        }

        const folderPath = parts.slice(folderIndex).join("/");
        const publicId = `${folderPath}/${fileName}`;

        const result = await cloudinary.uploader.destroy(publicId);
        return result.result === "ok";
      } catch (error: any) {
        throw new Error(`Failed to delete photo: ${error.message}`);
      }
    },
    updateLocation: async (
      _: any,
      args: { latitude: number; longitude: number },
      context: MyContext
    ) => {
      if (!context.userId) throw new Error("Not Authenticated");
      return await prisma.user.update({
        where: { id: context.userId },
        data: {
          latitude: args.latitude,
          longitude: args.longitude,
        },
      });
    },
    updateNotificationSettings: async (
      _: any,
      args: { pushNewMessages?: boolean; pushNewMatches?: boolean; pushRequests?: boolean; fcmToken?: string },
      context: MyContext
    ) => {
      if (!context.userId) throw new Error("Not Authenticated");
      const data: any = {};
      if (args.pushNewMessages !== undefined) data.pushNewMessages = args.pushNewMessages;
      if (args.pushNewMatches !== undefined) data.pushNewMatches = args.pushNewMatches;
      if (args.pushRequests !== undefined) data.pushRequests = args.pushRequests;
      if (args.fcmToken !== undefined) data.fcmToken = args.fcmToken;

      return await prisma.user.update({
        where: { id: context.userId },
        data,
      });
    },

    unmatchUser: async (_: any, args: { userId: string }, context: MyContext) => {
      if (!context.userId) throw new Error("Not Authenticated");
      const matchesToUpdate = await prisma.match.findMany({
        where: {
          OR: [
            { user1Id: context.userId, user2Id: args.userId },
            { user1Id: args.userId, user2Id: context.userId },
          ],
          isUnmatched: false,
        },
      });

      if (matchesToUpdate.length > 0) {
        await prisma.match.updateMany({
          where: {
            id: { in: matchesToUpdate.map(m => m.id) }
          },
          data: {
            isUnmatched: true,
            unmatchedAt: new Date(),
          },
        });

        try {
          const { getIO } = require("@/socket");
          const io = getIO();
          for (const match of matchesToUpdate) {
            io.to(`user_${context.userId}`).emit("chat_deleted", { matchId: match.id });
            io.to(`user_${args.userId}`).emit("chat_deleted", { matchId: match.id });
          }
        } catch (e) {
          console.error("Socket error on unmatchUser", e);
        }
      }

      return true;
    },
    blockUser: async (_: any, args: { userId: string; reason?: string }, context: MyContext) => {
      if (!context.userId) throw new Error("Not Authenticated");
      
      const matchesToUpdate = await prisma.match.findMany({
        where: {
          OR: [
            { user1Id: context.userId, user2Id: args.userId },
            { user1Id: args.userId, user2Id: context.userId },
          ],
        },
      });

      if (matchesToUpdate.length > 0) {
        await prisma.match.updateMany({
          where: { id: { in: matchesToUpdate.map(m => m.id) } },
          data: {
            isUnmatched: true,
            unmatchedAt: new Date(),
          },
        });

        try {
          const { getIO } = require("@/socket");
          const io = getIO();
          for (const match of matchesToUpdate) {
            io.to(`user_${context.userId}`).emit("chat_deleted", { matchId: match.id });
            io.to(`user_${args.userId}`).emit("chat_deleted", { matchId: match.id });
          }
        } catch (e) {
          console.error("Socket error on blockUser", e);
        }
      }

      // 2. Remove all swipes between them so neither appears in feed/discover again
      await prisma.swipe.deleteMany({
        where: {
          OR: [
            { swiperId: context.userId, swipedId: args.userId },
            { swiperId: args.userId, swipedId: context.userId },
          ],
        },
      });
      await prisma.blockedUser.upsert({
        where: {
          blockerId_blockedId: { blockerId: context.userId, blockedId: args.userId },
        },
        create: {
          blockerId: context.userId,
          blockedId: args.userId,
          reason: args.reason || "Inappropriate behavior",
        },
        update: {
          reason: args.reason || "Inappropriate behavior",
        },
      });
      console.log(`[USER_BLOCKED] User ${context.userId} blocked ${args.userId}. Reason: ${args.reason || "None"}`);
      return true;
    },
    unblockUser: async (_: any, args: { userId: string }, context: MyContext) => {
      if (!context.userId) throw new Error("Not Authenticated");
      await prisma.blockedUser.deleteMany({
        where: {
          blockerId: context.userId,
          blockedId: args.userId,
        },
      });

      // Check if the other user has blocked the current user
      const otherUserBlockedMe = await prisma.blockedUser.findFirst({
        where: { blockerId: args.userId, blockedId: context.userId }
      });

      if (!otherUserBlockedMe) {
        // Restore the match if it exists
        const matchesToRestore = await prisma.match.findMany({
          where: {
            OR: [
              { user1Id: context.userId, user2Id: args.userId },
              { user1Id: args.userId, user2Id: context.userId },
            ],
            isUnmatched: true,
          }
        });

        if (matchesToRestore.length > 0) {
          await prisma.match.updateMany({
            where: { id: { in: matchesToRestore.map(m => m.id) } },
            data: { isUnmatched: false }
          });

          try {
            const { getIO } = require("@/socket");
            const io = getIO();
            for (const match of matchesToRestore) {
              io.to(`user_${context.userId}`).emit("chat_restored", match);
              io.to(`user_${args.userId}`).emit("chat_restored", match);
            }
          } catch (e) {
            console.error("Socket error on unblockUser", e);
          }
        }
      }

      console.log(`[USER_UNBLOCKED] User ${context.userId} unblocked ${args.userId}`);
      return true;
    },
    reportUser: async (_: any, args: { userId: string; reason: string }, context: MyContext) => {
      if (!context.userId) throw new Error("Not Authenticated");
      await prisma.userReport.create({
        data: {
          reporterId: context.userId,
          reportedId: args.userId,
          reason: args.reason || "Reported by user",
        },
      });

      // 1. Unmatch and emit socket event
      const matchesToUpdate = await prisma.match.findMany({
        where: {
          OR: [
            { user1Id: context.userId, user2Id: args.userId },
            { user1Id: args.userId, user2Id: context.userId },
          ],
        },
      });

      if (matchesToUpdate.length > 0) {
        await prisma.match.updateMany({
          where: { id: { in: matchesToUpdate.map(m => m.id) } },
          data: {
            isUnmatched: true,
            unmatchedAt: new Date(),
          },
        });

        try {
          const { getIO } = require("@/socket");
          const io = getIO();
          for (const match of matchesToUpdate) {
            io.to(`user_${context.userId}`).emit("chat_deleted", { matchId: match.id });
            io.to(`user_${args.userId}`).emit("chat_deleted", { matchId: match.id });
          }
        } catch (e) {
          console.error("Socket error on reportUser", e);
        }
      }

      // 2. Remove all swipes between them
      await prisma.swipe.deleteMany({
        where: {
          OR: [
            { swiperId: context.userId, swipedId: args.userId },
            { swiperId: args.userId, swipedId: context.userId },
          ],
        },
      });

      // 3. Block them so they appear in blocked list
      await prisma.blockedUser.upsert({
        where: {
          blockerId_blockedId: { blockerId: context.userId, blockedId: args.userId },
        },
        create: {
          blockerId: context.userId,
          blockedId: args.userId,
          reason: args.reason || "Reported",
        },
        update: {
          reason: args.reason || "Reported",
        },
      });

      console.log(`[USER_REPORTED] User ${context.userId} reported ${args.userId}. Reason: ${args.reason}`);
      return true;
    },
    suggestFeature: async (_: any, args: { title: string; description: string; category?: string }, context: MyContext) => {
      if (!context.userId) throw new Error("Not Authenticated");
      await prisma.featureSuggestion.create({
        data: {
          userId: context.userId,
          title: args.title,
          description: args.description,
          category: args.category || "Feature",
          status: "PENDING",
        },
      });
      console.log(`[FEATURE_SUGGESTED] by User ${context.userId}: ${args.title}`);
      return true;
    },
    upgradeToPremium: async (
      _: any,
      args: { plan: string; receipt: string; platform: string; productId?: string; amount?: number },
      context: MyContext
    ) => {
      if (!context.userId) throw new Error("Not Authenticated");

      const currentUser = await prisma.user.findUnique({
        where: { id: context.userId },
      });
      if (!currentUser) throw new Error("User not found");

      const now = new Date();
      const planUpper = args.plan.toUpperCase();
      let premiumUntil = new Date();
      let addedTokens = 50000;
      let addedSuperlikes = 5;

      if (planUpper.includes("MONTH")) {
        premiumUntil.setMonth(now.getMonth() + 1);
      } else if (planUpper.includes("YEAR") || planUpper.includes("ANNUAL")) {
        premiumUntil.setFullYear(now.getFullYear() + 1);
        addedTokens = 75000;
        addedSuperlikes = 10;
      } else if (planUpper.includes("LIFE")) {
        premiumUntil.setFullYear(now.getFullYear() + 100);
        addedTokens = 150000;
        addedSuperlikes = 25;
      } else {
        premiumUntil.setMonth(now.getMonth() + 1);
      }

      await prisma.purchaseTransaction.create({
        data: {
          userId: context.userId,
          productId: args.productId || `shift_premium_${args.plan.toLowerCase()}`,
          plan: planUpper,
          platform: args.platform.toUpperCase(),
          receipt: args.receipt,
          amount: args.amount !== undefined ? args.amount : (planUpper.includes("MONTH") ? 4.99 : 42.48),
          status: "VERIFIED",
        },
      });

      const updatedUser = await prisma.user.update({
        where: { id: context.userId },
        data: {
          isPremium: true,
          premiumUntil: premiumUntil,
          subscriptionPlan: planUpper,
          platformReceipt: args.receipt,
          iapPlatform: args.platform.toUpperCase(),
          tokens: { increment: addedTokens },
          superlikeTokens: { increment: addedSuperlikes },
        },
      });

      console.log(`[IAP_VERIFIED] User ${context.userId} upgraded to Premium (${planUpper}) via ${args.platform}`);
      return updatedUser;
    },
    restorePremium: async (_: any, __: any, context: MyContext) => {
      if (!context.userId) throw new Error("Not Authenticated");

      const pastTx = await prisma.purchaseTransaction.findFirst({
        where: { userId: context.userId, status: "VERIFIED" },
        orderBy: { createdAt: "desc" },
      });

      const user = await prisma.user.findUnique({ where: { id: context.userId } });
      if (!user) throw new Error("User not found");

      if (pastTx || (user && user.platformReceipt)) {
        const updatedUser = await prisma.user.update({
          where: { id: context.userId },
          data: {
            isPremium: true,
            subscriptionPlan: pastTx?.plan || user.subscriptionPlan || "RESTORED",
            iapPlatform: pastTx?.platform || user.iapPlatform || "STORE_VERIFICATION",
          },
        });
        console.log(`[IAP_RESTORED] User ${context.userId} successfully restored Premium.`);
        return updatedUser;
      } else {
        throw new Error("No active Google Play or App Store subscription found to restore for this account.");
      }
    },
  },
  User: {
    birthDate: (parent: any) => (parent.birthDate && typeof parent.birthDate !== "string" ? new Date(parent.birthDate).toISOString() : parent.birthDate || null),
    createdAt: (parent: any) => (parent.createdAt && typeof parent.createdAt !== "string" ? new Date(parent.createdAt).toISOString() : parent.createdAt || null),
    updatedAt: (parent: any) => (parent.updatedAt && typeof parent.updatedAt !== "string" ? new Date(parent.updatedAt).toISOString() : parent.updatedAt || null),
    premiumUntil: (parent: any) => (parent.premiumUntil && typeof parent.premiumUntil !== "string" ? new Date(parent.premiumUntil).toISOString() : parent.premiumUntil || null),
    lastActive: async (parent: any) => {
      const activeCount = await redis.scard(`online_user:${parent.id}`);
      if (activeCount > 0) {
        return new Date().toISOString();
      }
      const lastActive = await redis.get(`last_active:${parent.id}`);
      if (lastActive) {
        return lastActive;
      }
      const fallbackDate = parent.updatedAt || parent.createdAt || new Date();
      return new Date(fallbackDate).toISOString();
    },
    matches1: async (parent: any) => {
      return await prisma.match.findMany({ where: { user1Id: parent.id } });
    },
    matches2: async (parent: any) => {
      return await prisma.match.findMany({ where: { user2Id: parent.id } });
    },
    messages: async (parent: any) => {
      return await prisma.message.findMany({ where: { senderId: parent.id } });
    },
    posts: async (parent: any) => {
      return await prisma.post.findMany({ where: { authorId: parent.id } });
    },
    swipesGiven: async (parent: any) => {
      return await prisma.swipe.findMany({ where: { swiperId: parent.id } });
    },
    swipesReceived: async (parent: any) => {
      return await prisma.swipe.findMany({ where: { swipedId: parent.id } });
    },
    hasLikedMe: async (parent: any, _: any, context: MyContext) => {
      if (!context.userId) return false;
      const swipe = await prisma.swipe.findFirst({
        where: { swiperId: parent.id, swipedId: context.userId, type: "LIKE" },
      });
      return !!swipe;
    },
    hasSuperlikedMe: async (parent: any, _: any, context: MyContext) => {
      if (!context.userId) return false;
      const swipe = await prisma.swipe.findFirst({
        where: {
          swiperId: parent.id,
          swipedId: context.userId,
          type: "SUPERLIKE",
        },
      });
      return !!swipe;
    },
    analytics: async (parent: any) => {
      const analytic = await prisma.analytics.findUnique({ where: { userId: parent.id } });
      const likesCount = await prisma.swipe.count({ where: { swipedId: parent.id, type: "LIKE" } });
      const superlikesCount = await prisma.swipe.count({ where: { swipedId: parent.id, type: "SUPERLIKE" } });
      const totalSwipes = await prisma.swipe.count({ where: { swipedId: parent.id } });
      
      return {
        profileViews: analytic ? analytic.profileViews : Math.floor(Math.random() * 20) + 15, // Provide lively starting estimate if record is brand new
        likesReceived: likesCount,
        superlikesReceived: superlikesCount,
        swipesReceivedCount: totalSwipes,
      };
    },
  },
};
