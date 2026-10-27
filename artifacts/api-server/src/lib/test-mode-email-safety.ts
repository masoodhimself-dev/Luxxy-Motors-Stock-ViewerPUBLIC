import { createHash } from 'node:crypto';

/** Test messages never include actionable links, even if a template or variable supplies one. */
export function renderTestText(value:string, values:Record<string,string>) {
  return value.replace(/{{\s*([a-z_]+)\s*}}/gi,(_match,key:string)=>values[key.toLowerCase()]??'')
    .replace(/(?:https?:\/\/|www\.|mailto:|tel:)\S+/gi,'[link omitted in test]');
}
/** Check the final prepared envelope, after all demo and provider transforms. */
export function assertTestEnvelope(body:unknown, recipient:string):void {
  if(!body || typeof body!=='object')throw new Error('Test envelope is invalid.');
  const data=body as Record<string,unknown>;
  if(!Array.isArray(data.to)||data.to.length!==1||typeof data.to[0]!=='string'||data.to[0].toLowerCase()!==recipient.toLowerCase()||'cc' in data||'bcc' in data||'reply_to' in data||'headers' in data)throw new Error('Test inbox safety check failed.');
}
export function assertTestPdf(content:string,sha256:string):void {
  const bytes=Buffer.from(content,'base64');
  if(bytes.length>8_000_000||!bytes.subarray(0,5).equals(Buffer.from('%PDF-'))||createHash('sha256').update(bytes).digest('hex')!==sha256)throw new Error('Test invoice archive could not be verified.');
}
/** Only the app's rendered email may be shown; reject any active or remote content. */
export function assertTestHtml(html:string):void {
  if(typeof html!=='string'||html.length>200_000||/<\s*(?:script|iframe|object|embed|form|input|button|link|base)\b/i.test(html)||/\s(?:href|src|srcset|on[a-z]+)\s*=/i.test(html)||/url\s*\(/i.test(html))throw new Error('The test email preview could not be safely displayed.');
}
