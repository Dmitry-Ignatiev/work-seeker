import { isIP } from 'node:net';

/** Pure IP classification for the SSRF guard. */

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

const V4_BLOCKED: [string, number][] = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, including cloud metadata 169.254.169.254
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, broadcast
];

function inV4Range(ip: string, [base, bits]: [string, number]): boolean {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

/** Expands an IPv6 address into 8 hextets (handles "::" and an embedded IPv4 tail). */
function expandV6(ip: string): number[] | null {
  let addr = ip.toLowerCase().split('%')[0];
  const v4Tail = addr.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Tail) {
    const n = ipv4ToInt(v4Tail[1]);
    addr = addr.replace(v4Tail[1], `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`);
  }
  const [head, tail] = addr.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined ? (tail ? tail.split(':') : []) : [];
  if (tail === undefined && h.length !== 8) return null;
  const parts = [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
  if (parts.length !== 8) return null;
  return parts.map(p => parseInt(p || '0', 16));
}

/**
 * True for addresses a server-side fetch must never reach: loopback, private, link-local
 * (cloud metadata), CGNAT, multicast, reserved, and their IPv6 equivalents (incl. IPv4-mapped).
 * Unparseable input is treated as blocked.
 */
export function isBlockedIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return V4_BLOCKED.some(range => inV4Range(ip, range));
  if (version !== 6) return true;

  const h = expandV6(ip);
  if (!h) return true;
  if (h.every(x => x === 0)) return true; // ::
  if (h.slice(0, 7).every(x => x === 0) && h[7] === 1) return true; // ::1
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible: judge the embedded IPv4 address.
  if (h.slice(0, 5).every(x => x === 0) && (h[5] === 0xffff || h[5] === 0)) {
    const v4 = `${h[6] >> 8}.${h[6] & 0xff}.${h[7] >> 8}.${h[7] & 0xff}`;
    return isBlockedIp(v4);
  }
  if ((h[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((h[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((h[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (h[0] === 0x2001 && h[1] === 0x0db8) return true; // documentation
  if (h[0] === 0x0064 && h[1] === 0xff9b) return true; // NAT64 can reach IPv4 internals
  return false;
}
