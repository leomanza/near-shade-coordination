// Vercel function entrypoint — re-exports the Hono app from src/index.ts.
// src/index.ts gates its serve() bind behind `if (!process.env.VERCEL)`.
import { handle } from 'hono/vercel';
import app from '../src/index';

export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);
export const OPTIONS = handle(app);
