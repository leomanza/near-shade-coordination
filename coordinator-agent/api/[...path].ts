// Vercel function entrypoint — re-exports the Hono app from src/index.ts.
// The import side-effect chain runs on cold-start; src/index.ts gates its
// serve() + background-loop init behind `if (!process.env.VERCEL)` so we
// only get the constructed app instance here, no port bind, no init loops.
import { handle } from 'hono/vercel';
import app from '../src/index';

export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);
export const OPTIONS = handle(app);
