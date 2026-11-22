import { describe, expect, it } from 'vitest';
import { asksForRemote, locationMatchesPlace } from '@/server/discovery/location';

describe('locationMatchesPlace', () => {
  it('matches a region to its cities', () => {
    expect(locationMatchesPlace('Center', 'Petah Tikva, Israel')).toBe(true);
    expect(locationMatchesPlace('המרכז', 'Tel Aviv-Yafo')).toBe(true);
    expect(locationMatchesPlace('Haifa and the North', 'Yokneam Illit')).toBe(true);
    expect(locationMatchesPlace('South', 'Beer Sheva')).toBe(true);
    // Sderot is in the South: a search there covers the whole region.
    expect(locationMatchesPlace('Sderot', "Be'er Sheva, Israel")).toBe(true);
    expect(locationMatchesPlace('שדרות', 'Ashkelon')).toBe(true);
    expect(locationMatchesPlace('Sderot', 'Tel Aviv')).toBe(false);
  });

  it('keeps other cities out', () => {
    expect(locationMatchesPlace('Jerusalem', 'Tel Aviv, Israel')).toBe(false);
    expect(locationMatchesPlace('Tel Aviv', 'Haifa')).toBe(false);
    expect(locationMatchesPlace('Center', 'Haifa')).toBe(false);
  });

  it('treats Israel or anywhere as the whole country, and other places as text to find', () => {
    expect(locationMatchesPlace('Israel', 'Haifa')).toBe(true);
    expect(locationMatchesPlace('anywhere', 'Berlin')).toBe(false);
    expect(locationMatchesPlace('Herzliya', 'Herzliya Pituach, Israel')).toBe(true);
  });
});

describe('asksForRemote', () => {
  it('recognises a request for remote work', () => {
    for (const place of ['Remote', 'remote only', 'work from home', 'מרחוק']) expect(asksForRemote(place)).toBe(true);
    for (const place of ['Tel Aviv', 'Israel', '', undefined]) expect(asksForRemote(place)).toBe(false);
  });
});
