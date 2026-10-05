import { handle } from '../../server/app.mjs';

/* The whole /api/v1 surface is one function; server/app.mjs routes it. */
export default (req, context) => handle(req, { ip: context?.ip });

export const config = { path: '/api/v1/*' };
