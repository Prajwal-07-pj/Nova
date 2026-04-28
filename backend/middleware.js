import { createSupabaseClient } from "./client.js";

// Simple JWT decoder without external dependency
function decodeJWT(token) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;

        const decoded = Buffer.from(parts[1], 'base64').toString('utf8');
        return JSON.parse(decoded);
    } catch (e) {
        return null;
    }
}

export async function middleware(req, res, next) {
    const requestPath = req.path || req.url || "unknown";
    console.log(`[middleware] Incoming ${req.method} request to ${requestPath}`);
    
    try {
        const authHeader = req.headers.authorization || "";
        console.log(`[middleware] Authorization header: ${authHeader ? "present" : "missing"}`);
        
        const token = authHeader.startsWith("Bearer ")
            ? authHeader.slice(7).trim()
            : authHeader.trim();

        if (!token) {
            console.warn("[middleware] ❌ No token found in auth header");
            return res.status(401).json({ message: "Missing auth token" });
        }

        console.log(`[middleware] Token length: ${token.length}`);

        if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
            console.error("[middleware] ❌ Missing Supabase config");
            return res.status(500).json({ message: "Server configuration error" });
        }

        console.log("[middleware] ✓ Creating Supabase client...");
        const client = createSupabaseClient();
        
        // Try using client.auth.getUser() method
        console.log("[middleware] Attempting client.auth.getUser()...");
        
        try {
            const { data, error } = await client.auth.getUser(token);
            
            if (error) {
                console.error("[middleware] getUser returned error:", {
                    message: error.message,
                    status: error.status,
                    code: error.code
                });
                
                // Fallback: Try manual JWT decoding
                console.log("[middleware] Attempting manual JWT decoding...");
                const decoded = decodeJWT(token);
                
                if (!decoded) {
                    console.error("[middleware] Failed to decode JWT");
                    return res.status(401).json({ message: "Invalid token format" });
                }
                
                console.log("[middleware] JWT Decoded successfully");
                console.log("[middleware] Payload:", {
                    sub: decoded?.sub,
                    email: decoded?.email,
                    exp: decoded?.exp ? new Date(decoded.exp * 1000) : "unknown",
                    iat: decoded?.iat ? new Date(decoded.iat * 1000) : "unknown"
                });
                
                // Check expiration
                if (decoded?.exp && decoded.exp < Math.floor(Date.now() / 1000)) {
                    console.error("[middleware] Token is expired");
                    return res.status(401).json({ message: "Token has expired" });
                }
                
                req.userId = decoded?.sub;
                req.authUser = {
                    id: decoded?.sub,
                    email: decoded?.email,
                    raw_user_meta_data: decoded
                };
                
                console.log(`[middleware] ✓ JWT decoded for user: ${decoded?.email}`);
                return next();
            }
            
            if (!data?.user?.id) {
                console.error("[middleware] No user in response from getUser");
                return res.status(401).json({ message: "Invalid auth token" });
            }
            
            console.log(`[middleware] ✓ Token verified for user: ${data.user.email}`);
            req.userId = data.user.id;
            req.authUser = data.user;
            return next();
        } catch (authError) {
            console.error("[middleware] Auth error:", authError.message);
            
            // Fallback to manual JWT decoding
            const decoded = decodeJWT(token);
            if (decoded && decoded.sub) {
                console.log("[middleware] ✓ Using decoded JWT as fallback");
                req.userId = decoded.sub;
                req.authUser = {
                    id: decoded.sub,
                    email: decoded.email,
                    raw_user_meta_data: decoded
                };
                return next();
            }
            
            return res.status(401).json({ 
                message: "Authentication failed",
                error: authError.message
            });
        }
        
    } catch (err) {
        console.error("[middleware] ❌ Unexpected error:", err.message);
        console.error("[middleware] Stack:", err.stack);
        return res.status(500).json({ 
            message: "Authentication failed", 
            error: err.message
        });
    }
}
