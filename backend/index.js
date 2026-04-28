import "dotenv/config";
import express from "express";
import { tavily } from "@tavily/core";
import { GoogleGenAI } from "@google/genai";
import { PROMPT_TEMPLATE, SYSTEM_PROMPT } from "./prompt.js";
import { z } from "zod";
import { middleware } from "./middleware.js";
import cors from "cors";
import prisma from "./db.js";
import Groq from "groq-sdk";
import OpenAI from "openai";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com",
});


const app = express();

app.use(cors());
app.use(express.json());

// Test endpoint - no auth required
app.get("/test", (req, res) => {
    console.log("[test] Received test request");
    res.json({ 
        status: "ok",
        timestamp: new Date().toISOString(),
        message: "Backend is working"
    });
});

// Health check endpoint
app.get("/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Get available models
app.get("/models", (req, res) => {
    res.json({
        models: [
            { id: "groq", name: "Groq (Llama 3.3 70B)", available: !!process.env.GROQ_API_KEY },
            { id: "deepseek", name: "Deepseek Chat", available: !!process.env.DEEPSEEK_API_KEY },
        ]
    });
});

// Debug endpoint to test auth
app.get("/debug/auth", middleware, async (req, res) => {
    try {
        res.json({
            message: "Auth successful",
            userId: req.userId,
            email: req.authUser?.email,
            provider: req.authUser?.app_metadata?.provider,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
});

const client = tavily({ apiKey: process.env.TAVILY_API_KEY });

function mapProvider(provider) {
    return provider === "google" ? "Google" : "Github";
}

function resolveName(authUser) {
    return (
        authUser?.user_metadata?.full_name ||
        authUser?.user_metadata?.name ||
        authUser?.email?.split("@")[0] ||
        "User"
    );
}

async function syncUserFromAuth(authUser) {
    const email = authUser?.email;
    const supabaseId = authUser?.id;
    
    if (!email) {
        throw new Error("Authenticated user does not have an email");
    }
    
    if (!supabaseId) {
        throw new Error("Authenticated user does not have a supabase ID");
    }

    const provider = mapProvider(
        String(authUser?.app_metadata?.provider || "github").toLowerCase()
    );

    try {
        // Try to find user by email or supabaseId
        let existingUser = await prisma.user.findUnique({ 
            where: { email } 
        });

        if (!existingUser) {
            // Check if supabaseId already exists for another user
            const userWithSupabaseId = await prisma.user.findUnique({
                where: { supabaseId }
            });
            
            if (userWithSupabaseId) {
                console.log(`[syncUserFromAuth] User with supabaseId exists, updating email from ${userWithSupabaseId.email} to ${email}`);
                // Update the existing user with the new email
                const updated = await prisma.user.update({
                    where: { supabaseId },
                    data: {
                        email,
                        provider,
                        name: resolveName(authUser),
                    },
                });
                return { user: updated, created: false };
            }
            
            console.log(`[syncUserFromAuth] Creating new user: ${email}`);
            const createdUser = await prisma.user.create({
                data: {
                    email,
                    provider,
                    name: resolveName(authUser),
                    supabaseId,
                },
            });
            console.log(`[syncUserFromAuth] Created user:`, createdUser.id);
            return { user: createdUser, created: true };
        }

        // User exists by email - ensure supabaseId is set correctly
        console.log(`[syncUserFromAuth] Updating existing user: ${email}`);
        const updatedUser = await prisma.user.update({
            where: { email },
            data: {
                provider,
                name: resolveName(authUser),
                supabaseId,
            },
        });
        console.log(`[syncUserFromAuth] Updated user:`, updatedUser.id);
        return { user: updatedUser, created: false };
    } catch (error) {
        console.error(`[syncUserFromAuth] Error for ${email}:`, error.message, error.code);
        throw error;
    }
}

app.post("/signup", middleware, async (req, res) => {
    try {
        console.log("[signup] Processing signup request");
        const { user, created } = await syncUserFromAuth(req.authUser);

        return res.status(created ? 201 : 200).json({
            message: created ? "Signup successful" : "User already exists",
            user,
        });
    } catch (error) {
        console.error("[signup] Error:", error.message, error.stack);
        return res.status(500).json({
            message: "Failed to complete signup",
            error: error.message,
        });
    }
});

// Test endpoint for debugging (no auth required)
app.post("/test/signin", async (req, res) => {
    try {
        console.log("[test/signin] Test signin without auth verification");
        
        // Create a fake auth user for testing
        const testAuthUser = {
            id: "test-user-123",
            email: "test@example.com",
            app_metadata: {
                provider: "google"
            }
        };
        
        const { user, created } = await syncUserFromAuth(testAuthUser);
        res.json({
            message: "Test signin successful",
            user,
            created
        });
    } catch (error) {
        console.error("[test/signin] Error:", error.message, error.stack);
        res.status(500).json({
            message: "Test signin failed",
            error: error.message
        });
    }
});

app.post("/signin", middleware, async (req, res) => {
    try {
        console.log("[signin] ========== SIGNIN REQUEST ==========");
        console.log("[signin] User ID:", req.userId);
        console.log("[signin] Auth User:", {
            id: req.authUser?.id,
            email: req.authUser?.email,
            provider: req.authUser?.app_metadata?.provider,
        });
        
        if (!req.authUser) {
            console.warn("[signin] No authenticated user in request");
            return res.status(401).json({ message: "No authenticated user" });
        }
        
        console.log(`[signin] Syncing user: ${req.authUser.email}`);
        const { user, created } = await syncUserFromAuth(req.authUser);
        
        console.log(`[signin] ✓ User synced successfully - Created: ${created}`);
        console.log("[signin] ========== SIGNIN SUCCESS ==========");

        return res.status(200).json({
            message: "Signin successful",
            user,
        });
    } catch (error) {
        console.error("[signin] ========== SIGNIN ERROR ==========");
        console.error("[signin] Error message:", error.message);
        console.error("[signin] Error code:", error.code);
        console.error("[signin] Stack:", error.stack);
        console.error("[signin] ========== END ERROR ==========");
        
        return res.status(500).json({
            message: "Failed to complete signin",
            error: error.message,
        });
    }
});

app.get("/conversation", middleware, async (req, res) => {
    try {
        const conversations = await prisma.conversation.findMany({
            where: { userId: req.userId },
            include: {
                _count: {
                    select: {
                        messages: true,
                    },
                },
            },
            orderBy: {
                id: "desc",
            },
        });

        return res.status(200).json({ conversations });
    } catch (error) {
        return res.status(500).json({
            message: "Failed to fetch conversations",
            error: error.message,
        });
    }
});

app.get("/conversation/:conversationId", middleware, async (req, res) => {
    const parsed = z.object({ conversationId: z.string().uuid() }).safeParse({
        conversationId: req.params.conversationId,
    });

    if (!parsed.success) {
        return res.status(400).json({ message: "Invalid conversation id" });
    }

    try {
        const conversation = await prisma.conversation.findFirst({
            where: {
                id: parsed.data.conversationId,
                userId: req.userId,
            },
            include: {
                messages: {
                    orderBy: {
                        createdAt: "asc",
                    },
                },
            },
        });

        if (!conversation) {
            return res.status(404).json({ message: "Conversation not found" });
        }

    res.json({
            conversation,
        });
    } catch (error) {
        return res.status(500).json({
            message: "Failed to fetch conversation",
            error: error.message,
        });
    }
});

app.post("/nova_ask", middleware, async (req, res) => {
    try {
        const query = req.body?.query;
        const model = req.body?.model || "groq"; // Default to groq, can be "groq" or "deepseek"
        
        if (!query || typeof query !== "string" || query.trim().length === 0) {
            return res.status(400).json({ message: "Query is required and must be non-empty" });
        }

        if (!['groq', 'deepseek'].includes(model)) {
            return res.status(400).json({ message: "Model must be 'groq' or 'deepseek'" });
        }

        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        console.log(`[nova_ask] Starting search for: ${query} (Model: ${model})`);

        // Web search to gather sources
        let webSearchResponse;
        try {
            webSearchResponse = await client.search(query, {
                searchDepth: "advanced",
            });
        } catch (searchError) {
            console.error("[nova_ask] Web search failed:", searchError.message);
            return res.status(500).json({ message: "Web search failed", error: searchError.message });
        }

        const WebSearchResult = webSearchResponse.results || [];
        console.log("[nova_ask] Found", WebSearchResult.length, "sources");

        // Build prompt
        const prompt = PROMPT_TEMPLATE
            .replace("{{WEB_SEARCH_RESULTS}}", JSON.stringify(webSearchResponse))
            .replace("{{USER_QUERY}}", query);

        // Stream LLM response based on model selection
        let stream;
        try {
            if (model === "groq") {
                console.log("[nova_ask] Using Groq model");
                stream = await groq.chat.completions.create({
                    model: "llama-3.3-70b-versatile",
                    messages: [
                        { role: "system", content: SYSTEM_PROMPT },
                        { role: "user", content: prompt },
                    ],
                    stream: true,
                });
            } else if (model === "deepseek") {
                console.log("[nova_ask] Using Deepseek model");
                stream = await deepseek.chat.completions.create({
                    model: "deepseek-chat",
                    messages: [
                        { role: "system", content: SYSTEM_PROMPT },
                        { role: "user", content: prompt },
                    ],
                    stream: true,
                });
            }
        } catch (aiError) {
            console.error(`[nova_ask] ${model} API failed:`, aiError.message);
            if (!res.headersSent) return res.status(500).json({ message: "LLM generation failed", error: aiError.message });
            return res.end();
        }

        // Stream answer text
        try {
            for await (const chunk of stream) {
                const text = chunk.choices[0]?.delta?.content || "";
                if (text) res.write(text);
            }
        } catch (streamError) {
            console.error("[nova_ask] Stream error:", streamError.message);
            res.end();
            return;
        }

        res.end();
        console.log(`[nova_ask] Completed successfully with ${model}`);
    } catch (error) {
        console.error("[nova_ask] Unexpected error:", error.message, error.stack);
        if (!res.headersSent) {
            return res.status(500).json({ message: "Request failed", error: error.message });
        }
        res.end();
    }
});

app.post("/nova_ask_followup",middleware,(req,res)=>{
    // Step 1 : getting the existing chat from DB
    // Step 2 : forward full histriy to the LLM
    // Step 3 : Stream the response to teh user
});

// Start server
const PORT = process.env.PORT || 3001;

async function startServer() {
    try {
        // Test database connection
        await prisma.$queryRaw`SELECT 1`;
        console.log("✓ Database connected successfully");

        app.listen(PORT, () => {
            console.log(`✓ Server running on http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error("✗ Failed to start server:", error.message);
        process.exit(1);
    }
}

startServer();

// Handle graceful shutdown
process.on("SIGINT", async () => {
    console.log("\nShutting down gracefully...");
    await prisma.$disconnect();
    process.exit(0);
});