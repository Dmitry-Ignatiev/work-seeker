import { describe, expect, it } from 'vitest';
import { jsearchParams } from '@/server/discovery/sources/jsearch';

const params = (input: Parameters<typeof jsearchParams>[0]) => Object.fromEntries(jsearchParams(input));

describe('jsearchParams', () => {
  it('searches Israel by default', () => {
    expect(params({ query: 'qa automation engineer' })).toMatchObject({ query: 'qa automation engineer in Israel', country: 'il' });
    expect(params({ query: 'qa automation engineer' }).work_from_home).toBeUndefined();
  });

  it('keeps a city inside Israel', () => {
    expect(params({ query: 'data scientist', location: 'Haifa' })).toMatchObject({ query: 'data scientist in Haifa, Israel', country: 'il' });
    expect(params({ query: 'data scientist', location: 'Israel' }).query).toBe('data scientist in Israel');
  });

  it('asks for remote roles open to people in Israel when remote is wanted', () => {
    expect(params({ query: 'devops engineer', remoteOnly: true })).toMatchObject({
      query: 'devops engineer in Israel',
      country: 'il',
      work_from_home: 'true',
    });
    expect(params({ query: 'devops engineer', location: 'Remote' }).work_from_home).toBe('true');
  });
});
