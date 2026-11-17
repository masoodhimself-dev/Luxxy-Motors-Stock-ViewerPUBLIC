import { createHash } from 'node:crypto';
import type { RequestHandler } from 'express';
import { multiTenantEnabled, normaliseTenantHost } from '../lib/tenant-context';

const styles = `
  :root{color-scheme:light;font-family:system-ui,-apple-system,BlinkMacSystemFont,sans-serif;color:#182438;background:#f5f6f8}
  *{box-sizing:border-box}
  body{margin:0}
  a{color:#304e82;text-underline-offset:.2em}
  a:focus-visible{outline:3px solid #385a94;outline-offset:4px;border-radius:2px}
  header{background:#fff;border-bottom:1px solid #dfe3eb}
  .header-inner{max-width:74rem;min-height:4.25rem;margin:0 auto;padding:.5rem clamp(1.25rem,5vw,3rem);display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:.5rem 1.5rem}
  .logo{display:inline-flex;align-items:center;min-height:2.75rem;color:#182438;font-size:1.45rem;font-weight:750;text-decoration:none}
  .logo span{color:#385a94}
  .sign-in{display:inline-flex;align-items:center;min-height:2.75rem;font-weight:650}
  main{width:min(calc(100% - 2.5rem),41rem);margin:0 auto;padding:clamp(3rem,8vw,5.5rem) 0}
  h1{margin:0 0 1.25rem;font-size:clamp(2rem,6vw,2.875rem);line-height:1.1;letter-spacing:-.025em}
  h2{margin:2rem 0 .5rem;font-size:1.125rem;line-height:1.35}
  p{margin:0 0 1rem;color:#4d5a6d;font-size:1rem;line-height:1.65;overflow-wrap:anywhere}
  .intro{font-size:1.125rem}
  .actions{display:flex;align-items:center;flex-wrap:wrap;gap:.75rem 1.5rem;margin-top:2rem}
  .actions a{display:inline-flex;align-items:center;min-height:2.75rem}
  .primary{padding:.625rem 1rem;border-radius:.375rem;background:#253a62;color:#fff;font-weight:650;text-decoration:none}
  .primary:hover{background:#1c2d4f}
`;
const styleDigest = createHash('sha256').update(styles).digest('base64');

function supportLink() {
  const address = process.env.STAFF_PORTAL_PUBLIC_SUPPORT_EMAIL?.trim();
  // The limited mailbox alphabet excludes HTML and mailto header delimiters.
  if (!address || address.length > 254 || !/^[a-z0-9][a-z0-9._+-]*@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(address)) return '';
  return `<h2>Contact</h2><p>Email <a href="mailto:${address}">${address}</a> for questions or requests about the personal information used for staff sign-in.</p>`;
}

function page(title: string, content: string) {
  return `<!doctype html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title} | DealerOS</title>
  <style>${styles}</style>
</head>
<body>
  <header><div class="header-inner">
    <a class="logo" href="/about" aria-label="About DealerOS">Dealer<span>OS</span></a>
    <a class="sign-in" href="/portal">Staff sign-in</a>
  </div></header>
  <main><h1>${title}</h1>${content}</main>
</body>
</html>`;
}

const about = page('DealerOS staff portal', `
  <p class="intro">DealerOS helps motor dealerships manage vehicle stock, customer enquiries, sales and paperwork.</p>
  <p>The staff portal is invitation-only. Sign in once to see the dealership workspaces you have access to. Your role at each dealership controls what you can see and do.</p>
  <p>If you sign in with Google, basic account details help us recognise your staff account.</p>
  <div class="actions"><a class="primary" href="/portal">Sign in to DealerOS</a><a href="/privacy">Staff sign-in privacy</a></div>
`);

function privacy() {
  return page('Staff sign-in privacy', `
  <p class="intro">This notice covers account information used to sign in to the DealerOS staff portal.</p>
  <h2>Your staff account</h2>
  <p>DealerOS stores your name, email address, Clerk account ID and dealership role with your staff membership. We use these details to sign you in and check which workspaces you can access. Authorised dealership owners can see membership details for their dealership to manage staff access.</p>
  <h2>Signing in with Google</h2>
  <p>Clerk processes sign-in for DealerOS. If you choose Google, Google shares your account identifier, email address and basic profile information, such as your name and profile photo, with Clerk. DealerOS uses your verified email address to match your invitation and your Clerk account ID to recognise you when you return.</p>
  <p>We use the Google data for sign-in and account verification. We do not use it for marketing. Google sign-in does not give DealerOS access to your Gmail, Google Drive files or other Google content.</p>
  <h2>Manage your access</h2>
  <p>You can remove the Google connection in <a href="https://myaccount.google.com/connections">your Google Account settings</a>. This stops the Google connection and does not delete any staff membership information already held by DealerOS. Your dealership owner can remove your workspace access and pass questions about correcting or deleting your sign-in information to DealerOS.</p>
  ${supportLink()}
  <div class="actions"><a href="/about">About the DealerOS staff portal</a></div>
  `);
}

export const sharedStaffInfo: RequestHandler = (req, res, next) => {
  if ((req.method !== 'GET' && req.method !== 'HEAD') ||
      (req.path !== '/about' && req.path !== '/privacy' && req.path !== '/robots.txt') ||
      process.env.STAFF_PORTAL_PUBLIC_INFO_ENABLED !== 'true' || !multiTenantEnabled()) {
    next();
    return;
  }

  const configuredHost = process.env.STAFF_PORTAL_HOST?.trim().toLowerCase();
  const host = normaliseTenantHost(configuredHost ?? '');
  if (!host || host !== configuredHost || normaliseTenantHost(req.get('host') ?? '') !== host ||
      host === normaliseTenantHost(process.env.PLATFORM_ADMIN_HOST ?? '') ||
      host === normaliseTenantHost(process.env.STOCK_IMPORT_API_HOST ?? '')) {
    next();
    return;
  }

  res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
  if (req.path === '/robots.txt') {
    res.type('text').send('User-agent: *\nDisallow: /\nAllow: /about$\nAllow: /privacy$\n');
    return;
  }

  res.set('Content-Security-Policy', `default-src 'none'; style-src 'sha256-${styleDigest}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
  res.type('html').send(req.path === '/about' ? about : privacy());
};
