import { Router, Request, Response } from "express";
import prisma from "../utils/prisma";

const router = Router();

// ---------------------------------------------------------------------------
// Allowed query types (must match the ContactQueryType enum in schema.prisma)
// ---------------------------------------------------------------------------
const VALID_QUERY_TYPES = [
  "GENERAL",
  "BUG_REPORT",
  "FEATURE_REQUEST",
  "ACCOUNT_ISSUE",
  "BILLING",
  "OTHER",
] as const;

type ContactQueryType = (typeof VALID_QUERY_TYPES)[number];

// ---------------------------------------------------------------------------
// POST /api/contact
// ---------------------------------------------------------------------------
router.post("/", async (req: Request, res: Response): Promise<void> => {
  // 1. ── Secret-key auth ───────────────────────────────────────────────────
  const apiKey = req.headers["x-api-key"];
  const expectedKey = "13253053-dc89-430a-96e0-98139698a44e";

  if (!expectedKey) {
    console.error("[contact] CONTACT_API_SECRET env var is not set");
    res.status(500).json({ success: false, error: "Server misconfiguration" });
    return;
  }

  if (!apiKey || apiKey !== expectedKey) {
    res.status(401).json({
      success: false,
      error: "Unauthorized: invalid or missing x-api-key header",
    });
    return;
  }

  // 2. ── Validate body ─────────────────────────────────────────────────────
  const { name, email, queryType, message, ipAddress } = req.body as {
    name?: string;
    email?: string;
    queryType?: string;
    message?: string;
    ipAddress?: string;
  };

  const missing: string[] = [];
  if (!name?.trim()) missing.push("name");
  if (!email?.trim()) missing.push("email");
  if (!queryType?.trim()) missing.push("queryType");
  if (!message?.trim()) missing.push("message");

  if (missing.length > 0) {
    res.status(400).json({
      success: false,
      error: `Missing required fields: ${missing.join(", ")}`,
    });
    return;
  }

  // Validate e-mail format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email!)) {
    res.status(400).json({ success: false, error: "Invalid email address" });
    return;
  }

  // Validate queryType against enum
  if (!VALID_QUERY_TYPES.includes(queryType as ContactQueryType)) {
    res.status(400).json({
      success: false,
      error: `Invalid queryType. Must be one of: ${VALID_QUERY_TYPES.join(", ")}`,
    });
    return;
  }

  // 3. ── Resolve IP address ────────────────────────────────────────────────
  // Prefer the caller-supplied value; fall back to the request's IP.
  const resolvedIp =
    ipAddress?.trim() ||
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.socket.remoteAddress ||
    null;

  // 4. ── Persist to DB ─────────────────────────────────────────────────────
  try {
    const submission = await prisma.contactSubmission.create({
      data: {
        name: name!.trim(),
        email: email!.trim().toLowerCase(),
        queryType: queryType as ContactQueryType,
        message: message!.trim(),
        ipAddress: resolvedIp,
        // createdAt is @default(now()) — set automatically by Prisma/DB
      },
    });

    res.status(201).json({
      success: true,
      data: {
        id: submission.id,
        name: submission.name,
        email: submission.email,
        queryType: submission.queryType,
        message: submission.message,
        ipAddress: submission.ipAddress,
        createdAt: submission.createdAt,
      },
    });
  } catch (err) {
    console.error("[contact] DB error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

export default router;
