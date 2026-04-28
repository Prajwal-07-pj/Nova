import { PrismaClient } from './generated/prisma/client.js'
import { PrismaPg } from "@prisma/adapter-pg"

if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL environment variable is not set");
}

const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
})

const prisma = new PrismaClient({
    adapter,
    log: ['error', 'warn'],
})

// Handle connection errors
prisma.$on('error', (e) => {
    console.error('Prisma error:', e);
})

export default prisma