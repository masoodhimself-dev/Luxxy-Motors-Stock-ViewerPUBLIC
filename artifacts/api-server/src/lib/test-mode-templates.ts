import { pool } from '@workspace/db';
import { dealerIntegrationsStore } from './dealer-integrations-store';
import { emailTemplateVariables, type EmailTemplate } from '@workspace/vehicle-meta';

/** Call only after authorizing an active session in the current tenant. */
export async function testModeTemplates(sessionId:string):Promise<{revision:number;templates:EmailTemplate[];variables:readonly string[]}> {
  const row=(await pool.query('SELECT templates,templates_revision FROM sales_test_settings WHERE session_id=$1',[sessionId])).rows[0];
  if(row?.templates) return {revision:row.templates_revision,templates:row.templates,variables:emailTemplateVariables};
  const current=await dealerIntegrationsStore.listTemplates();
  return {revision:1,templates:current.templates,variables:emailTemplateVariables};
}
