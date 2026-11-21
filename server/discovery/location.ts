/** Pure helpers to recognise Israeli and remote locations in free-text location fields. */

const ISRAEL =
  /\b(israel|tel[\s-]?aviv|tlv|herzliy?a|haifa|jerusalem|petah[\s-]?tik?va|petach[\s-]?tikva|ra'?anana|ramat[\s-]?gan|be'?er[\s-]?sheva|beersheba|netanya|rehovot|yokneam|yoqneam|hod[\s-]?hasharon|kfar[\s-]?saba|or[\s-]?yehuda|modi'?in|caesarea|givatayim|airport[\s-]?city|bnei[\s-]?brak|holon|rishon|ness[\s-]?ziona|ashdod|nazareth|matam)\b|ישראל|תל[\s-]?אביב|ת"א|המרכז|הרצליה|חיפה|ירושלים|פתח[\s-]?תקווה|רעננה|רמת[\s-]?גן|באר[\s-]?שבע|נתניה|רחובות|יקנעם|הצפון|הדרום|השרון/i;
const REMOTE = /\b(remote|anywhere|work from home|wfh|distributed)\b|מהבית|היברידי מלא/i;

export function isIsraelLocation(text: string | undefined | null): boolean {
  return Boolean(text && (ISRAEL.test(text) || /^\s*IL\s*$/.test(text)));
}

export function isRemoteLocation(text: string | undefined | null): boolean {
  return Boolean(text && REMOTE.test(text));
}

/** Did the user ask for remote work ("remote", "work from home", "מרחוק")? */
export function asksForRemote(place: string | undefined | null): boolean {
  return Boolean(place && /\b(remote|work from home|wfh)\b|מרחוק|מהבית/i.test(place));
}

const TEL_AVIV = String.raw`tel[\s-]?aviv|\btlv\b|jaffa|yafo|תל[\s-]?אביב|ת"א|יפו`;
/** Regions people name, and the job locations that belong to each. */
const REGIONS: { asked: RegExp; located: RegExp }[] = [
  { asked: new RegExp(TEL_AVIV, 'i'), located: new RegExp(TEL_AVIV, 'i') },
  {
    asked: /\b(center|centre|central|gush dan)\b|מרכז/i,
    located: new RegExp(
      TEL_AVIV +
        String.raw`|ramat[\s-]?gan|givatayim|petah?c?h?[\s-]?tik?va|herzliy?a|ra'?anana|kfar[\s-]?saba|hod[\s-]?hasharon|rishon|holon|bnei[\s-]?brak|or[\s-]?yehuda|airport[\s-]?city|rehovot|ness[\s-]?ziona|modi'?in|netanya|\blod\b|ramla|yehud|המרכז|רמת[\s-]?גן|פתח[\s-]?תקווה|הרצליה|רעננה|כפר[\s-]?סבא|השרון|נתניה|רחובות`,
      'i',
    ),
  },
  { asked: /jerusalem|ירושלים/i, located: /jerusalem|ירושלים/i },
  {
    asked: /haifa|\bnorth\b|חיפה|צפון/i,
    located: /haifa|yo[kq]neam|nazareth|caesarea|matam|karmiel|tiberias|חיפה|יקנעם|הצפון|נצרת|קיסריה/i,
  },
  {
    asked: /\bsouth\b|be'?er[\s-]?sheva|beersheba|דרום|באר[\s-]?שבע/i,
    located: /be'?er[\s-]?sheva|beersheba|ashdod|ashkelon|eilat|באר[\s-]?שבע|אשדוד|הדרום/i,
  },
];

/**
 * Is a job's location in the place the user asked for? A region ("the Center", "Haifa and the North") covers
 * its cities; "Israel" or "anywhere" covers the whole country; any other place must appear in the location.
 */
export function locationMatchesPlace(place: string, location: string): boolean {
  const asked = place.trim();
  if (!asked || /^(israel|anywhere|anywhere in israel|ישראל|בכל הארץ)$/i.test(asked)) return isIsraelLocation(location);
  const region = REGIONS.find(r => r.asked.test(asked));
  if (region) return region.located.test(location);
  return location.toLowerCase().includes(asked.toLowerCase());
}
