import { createClient } from "@supabase/supabase-js";

export function createSupabaseClient() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url) {
        throw new Error("SUPABASE_URL environment variable is missing");
    }
    
    if (!key) {
        throw new Error("SUPABASE_SERVICE_ROLE_KEY environment variable is missing");
    }

    console.log("[client] Creating Supabase client with URL:", url.substring(0, 40) + "...");
    
    try {
        const client = createClient(url, key, {
            auth: {
                persistSession: false,
                autoRefreshToken: false
            }
        });
        
        console.log("[client] ✓ Supabase client created successfully");
        return client;
    } catch (error) {
        console.error("[client] ❌ Error creating Supabase client:", error.message);
        throw error;
    }
}