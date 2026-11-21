import { describe, expect, it } from 'vitest';
import { isIsraelLocation, locationMatchesPlace } from '@/server/discovery/location';
import { jsearchLocation, jsearchParams } from '@/server/discovery/sources/jsearch';

const params = (input: Parameters<typeof jsearchParams>[0]) => Object.fromEntries(jsearchParams(input));

describe('jsearchParams', () => {
  it('searches Israel by default', () => {
    expect(params({ query: 'qa automation engineer' })).toEqual({
      query: 'qa automation engineer in Israel',
      num_pages: '1',
      country: 'il',
    });
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

describe('jsearchLocation', () => {
  it('spells out Israel for Hebrew city names with the IL code', () => {
    const location = jsearchLocation({ job_city: 'יפו', job_country: 'IL' });
    expect(location).toBe('יפו, Israel');
    expect(isIsraelLocation(location)).toBe(true);
    expect(locationMatchesPlace('Tel Aviv', location)).toBe(true);
  });

  it('corrects Israeli cities that Google labels as US', () => {
    expect(jsearchLocation({ job_city: 'Tel Aviv-Yafo', job_country: 'US' })).toBe('Tel Aviv-Yafo, Israel');
    expect(jsearchLocation({ job_city: 'Austin', job_state: 'TX', job_country: 'US' })).toBe('Austin, TX, US');
  });
});
