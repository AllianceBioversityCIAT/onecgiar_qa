import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { join } from 'node:path';
import { isSpPath, spFrameAncestorsPolicy } from './sp-frame-ancestors';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

/**
 * P2-3911: the Science Program view (`/sp`, `/sp/*`) is framed by Reporting only. Its pages carry
 * `Content-Security-Policy: frame-ancestors <SP_FRAME_ANCESTORS>` (space-separated exact origins; invalid
 * entries are ignored; unset or empty = `'none'`). Other routes keep their headers. If CloudFront serves
 * `/sp` HTML from its cache, the same header must be set in its response-headers policy for `/sp*`.
 */
const spFramePolicy = spFrameAncestorsPolicy(process.env['SP_FRAME_ANCESTORS']);
app.use((req, res, next) => {
  if (isSpPath(req.path)) res.setHeader('Content-Security-Policy', spFramePolicy);
  next();
});

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) => (response ? writeResponseToNodeResponse(response, res) : next()))
    .catch(next);
});

/**
 * Start the server if this module is the main entry point, or it is ran via PM2.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, (error) => {
    if (error) {
      throw error;
    }

    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);
