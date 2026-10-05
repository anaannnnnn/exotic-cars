/* /api/v1/<anything> straight to the same handlers when Vercel routes the catch-all file itself (the original URL and
   query reach the function); otherwise vercel.json rewrites to api/index.js. Either way the same code answers. */
export * from '../index.js';
