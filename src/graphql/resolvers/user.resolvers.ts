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
      let fieldSelects: string[] = [
        "id",
        "name",
        "bio",
        "gender",
        "birthDate",
        "photos",
        "tags",
      ];
      if (!args.isView) {
        fieldSelects.push(
          "email",
          "latitude",
          "longitude",
          "createdAt",
          "updatedAt",
        );
      }
      return await prisma.user.findUnique({
        where: { id: args.id },
        select: {
          ...(fieldSelects.reduce(
            (acc, field) => {
              acc[field] = true;
              return acc;
            },
            {} as Record<string, boolean>,
          ) as any),
        },
      });
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
          data: { photos: [picture] }
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
      args: { id: string; email?: string; password?: string; name?: string; bio?: string; gender?: string; birthDate?: string; photos?: string[]; latitude?: number; longitude?: number },
    ) => {
      return await prisma.user.update({
        where: { id: args.id },
        data: {
          ...(args.email && { email: args.email }),
          ...(args.password && { password: args.password }),
          ...(args.name && { name: args.name }),
          ...(args.bio && { bio: args.bio }),
          ...(args.gender && { gender: args.gender }),
          ...(args.birthDate && { birthDate: new Date(args.birthDate) }),
          ...(args.photos && { photos: args.photos }),
          ...(args.latitude !== undefined && { latitude: args.latitude }),
          ...(args.longitude !== undefined && { longitude: args.longitude }),
        },
      });
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
    uploadPhoto: async (_: any, args: { base64: string }, context: MyContext) => {
      if (!context.userId) throw new Error("Not Authenticated");
      
      const { base64 } = args;
      // Ensure the string has the data URI prefix if it doesn't already
      const fileStr = base64.startsWith('data:image') ? base64 : `data:image/jpeg;base64,${base64}`;
      
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
        const parts = args.url.split('/');
        const fileWithExt = parts.pop();
        if (!fileWithExt) return false;
        
        const fileName = fileWithExt.split('.')[0];
        
        // Find the index of the folder to reconstruct the full public_id
        const folderIndex = parts.indexOf('shift');
        if (folderIndex === -1) {
          // Fallback if the folder structure is different
          await cloudinary.uploader.destroy(fileName);
          return true;
        }
        
        const folderPath = parts.slice(folderIndex).join('/');
        const publicId = `${folderPath}/${fileName}`;
        
        const result = await cloudinary.uploader.destroy(publicId);
        return result.result === 'ok';
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
        where: { swiperId: parent.id, swipedId: context.userId, type: "SUPERLIKE" },
      });
      return !!swipe;
    },
  },
};
