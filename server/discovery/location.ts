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
