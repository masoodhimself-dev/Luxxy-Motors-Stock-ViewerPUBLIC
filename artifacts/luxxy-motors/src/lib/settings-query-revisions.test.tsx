import { expect, it, vi, afterEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { getGetDealerSettingsQueryKey, getGetDealerSettingsQueryOptions, getSettingsRevision } from '@workspace/api-client-react';
import { previewSettings } from '../../preview/settings';

afterEach(()=>vi.unstubAllGlobals());

it('retains HTTP publication versions when the shared settings cache reuses equal JSON',async()=>{
  let revision=4, settings=structuredClone(previewSettings);
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json(settings,{headers:{'x-settings-revision':String(revision)}})));
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  const first=await client.fetchQuery(getGetDealerSettingsQueryOptions());
  expect(getSettingsRevision(first)).toBe(4);
  revision=5;
  await client.fetchQuery(getGetDealerSettingsQueryOptions());
  const equal=client.getQueryData<typeof first>(getGetDealerSettingsQueryKey())!;
  expect(equal).toBe(first);
  expect(getSettingsRevision(equal)).toBe(5);
  revision=6;settings={...settings,contact:{...settings.contact,phone:'020 7946 0123'}};
  await client.fetchQuery(getGetDealerSettingsQueryOptions());
  const changed=client.getQueryData<typeof first>(getGetDealerSettingsQueryKey())!;
  expect(changed).not.toBe(first);expect(changed.identity).toBe(first.identity);
  expect(getSettingsRevision(changed)).toBe(6);
  expect(JSON.stringify(changed)).not.toContain('x-settings-revision');
  client.clear();
});
