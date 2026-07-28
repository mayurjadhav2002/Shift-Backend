import { LoginProvider } from "@/generated/prisma/enums";
import prisma from "@/utils/prisma";
import { generateToken } from "@/utils/tokens";
import { MyContext } from "@/middleware/auth";
import { OAuth2Client } from "google-auth-library";
import { v2 as cloudinary } from "cloudinary";

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

    getProfile: async (_: any, args: { id: string; isView: boolean }) => {
      const user: any = await prisma.user.findUnique({
        where: { id: args.id },
        include: { tags: true },
      });
      if (!user) return null;

      if (args.isView) {
        // Hide private fields when viewing someone else's profile
        user.email = "";
        user.latitude = null;
        user.longitude = null;
      }

      if (user.prompts && typeof user.prompts === "object") {
        user.prompts = JSON.stringify(user.prompts) as any;
      }

      if (user.tags) {
        user.tags = user.tags.map((t: any) => t.name);
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

      let nextRewardDay = (user.rewardDayCounter % 7) + 1;

      return {
        nextRewardDay,
        canClaimToday,
        serverTime: now.toISOString(),
      };
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
      const userExists = await prisma.user.findUnique({
        where: { email: args.email },
      });
      if (userExists) {
        user = await prisma.user.update({
          where: { email: args.email },
          data: {
            email: args.email,
            password: args.password,
            name: args.name,
            loginProvider: args.loginProvider,
          },
        });
      } else {
        user = await prisma.user.create({
          data: {
            email: args.email,
            password: args.password,
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
      },
    ) => {
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
      let user = await prisma.user.create({
        data: {
          email: args.email,
          password: args.password,
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

      const nextRewardDay = (user.rewardDayCounter % 7) + 1;

      let updateData: any = {
        lastRewardClaimDate: now,
        rewardDayCounter: nextRewardDay,
      };

      if (nextRewardDay === 1) updateData.tokens = { increment: 50 };
      if (nextRewardDay === 2) updateData.superlikeTokens = { increment: 1 };
      if (nextRewardDay === 3) updateData.tokens = { increment: 100 };
      if (nextRewardDay === 4) updateData.dmTokens = { increment: 1 };
      if (nextRewardDay === 5) updateData.tokens = { increment: 150 };
      if (nextRewardDay === 6) updateData.rewindTokens = { increment: 2 };
      if (nextRewardDay === 7) updateData.tokens = { increment: 250 };

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
  },
  User: {
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
  },
};
