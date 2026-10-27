import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { assertTestEnvelope, assertTestPdf, assertTestHtml, renderTestText } from './lib/test-mode-email-safety';

test('only the approved test inbox may receive a test message',()=>{
  assert.doesNotThrow(()=>assertTestEnvelope({to:['test@example.test']},'Test@example.test'));
  for(const body of [{to:['customer@example.test']},{to:['test@example.test','customer@example.test']},{to:['test@example.test'],cc:['customer@example.test']},{to:['test@example.test'],bcc:['customer@example.test']},{to:['test@example.test'],reply_to:'customer@example.test'},{to:['test@example.test'],headers:{References:'real-thread'}},{}])
    assert.throws(()=>assertTestEnvelope(body,'test@example.test'));
});
test('links in both dealer templates and customer variables are stripped',()=>{
  const result=renderTestText('Go https://dealer.test/pay or www.example.test and mailto:hello@example.test tel:0123 {{message}}',{message:'https://customer.example/action'});
  assert.equal(result,'Go [link omitted in test] or [link omitted in test] and [link omitted in test] [link omitted in test] [link omitted in test]');
});
test('invoice attachments must be actual PDF bytes with a matching stored checksum',()=>{
  const pdf=Buffer.from('%PDF-1.4\ntest');const sum=createHash('sha256').update(pdf).digest('hex');
  assert.doesNotThrow(()=>assertTestPdf(pdf.toString('base64'),sum));
  assert.throws(()=>assertTestPdf(pdf.toString('base64'),'0'.repeat(64)));
  assert.throws(()=>assertTestPdf(Buffer.from('not pdf').toString('base64'),sum));
});
test('test HTML rejects active content and remote resources',()=>{
  assert.doesNotThrow(()=>assertTestHtml('<html><body><p>Safe &lt;script&gt;</p></body></html>'));
  for(const html of ['<script>alert(1)</script>','<img src="https://example.test">','<a href="tel:123">Call</a>','<div onclick="alert(1)">','<form><input></form>','<style>p{background:url(https://example.test)}</style>'])assert.throws(()=>assertTestHtml(html));
});
