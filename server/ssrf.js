import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";

export const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
  "metadata.aws.internal",
  "kubernetes",
  "kubernetes.default",
  "kubernetes.default.svc",
  "kubernetes.default.svc.cluster.local",
]);

const BLOCKED_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".corp",
  ".home",
  ".lan",
  ".intranet",
  ".private",
];

const BLOCKED_IP_RANGES = new Set([
  "unspecified",
  "broadcast",
  "multicast",
  "linkLocal",
  "loopback",
  "private",
  "reserved",
  "uniqueLocal",
  "carrierGradeNat",
  "benchmarking",
  "discard",
  "ipv4Mapped",
]);

export class UrlValidationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "UrlValidationError";
    this.status = status;
  }
}

export function normalizeTargetUrl(raw) {
  if (typeof raw !== "string") {
    throw new UrlValidationError("Missing URL.");
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    throw new UrlValidationError("Missing URL.");
  }
  if (trimmed.length > 2048) {
    throw new UrlValidationError("URL is too long.");
  }
  if (/\s/.test(trimmed)) {
    throw new UrlValidationError("URL contains whitespace.");
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new UrlValidationError("Enter a valid http(s) URL.");
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new UrlValidationError(
      "Only http and https URLs can be proxied.",
      400,
    );
  }

  if (parsed.username || parsed.password) {
    throw new UrlValidationError("URLs with credentials are not allowed.");
  }

  if (!parsed.hostname) {
    throw new UrlValidationError("URL is missing a hostname.");
  }

  assertHostnameAllowed(parsed.hostname);
  assertLiteralIpAllowed(parsed.hostname);

  parsed.hash = "";
  return parsed;
}

export function assertHostnameAllowed(hostname) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();

  if (BLOCKED_HOSTS.has(host)) {
    throw new UrlValidationError("This host is blocked.", 403);
  }

  if (BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    throw new UrlValidationError("This host is blocked.", 403);
  }
}

export function isBlockedIp(ip) {
  let addr;
  try {
    addr = ipaddr.process(ip);
  } catch {
    return true;
  }

  const range = addr.range();
  if (BLOCKED_IP_RANGES.has(range)) {
    return true;
  }

  if (addr.kind() === "ipv6" && addr.isIPv4MappedAddress()) {
    return isBlockedIp(addr.toIPv4Address().toString());
  }

  return false;
}

export function assertLiteralIpAllowed(hostname) {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (!isIP(host) && !looksLikeIpLiteral(host)) {
    return;
  }

  if (isBlockedIp(host) || !isValidPublicLiteral(host)) {
    throw new UrlValidationError("Private or reserved addresses are blocked.", 403);
  }
}

function looksLikeIpLiteral(host) {
  if (/^\d+$/.test(host)) return true;
  if (/^0x[0-9a-f]+$/i.test(host)) return true;
  if (/^[\d.]+$/.test(host) && host.includes(".")) return true;
  return ipaddr.isValid(host);
}

function isValidPublicLiteral(host) {
  try {
    const addr = ipaddr.process(host);
    return !isBlockedIp(addr.toString());
  } catch {
    return false;
  }
}

export async function resolvePublicAddresses(hostname) {
  const host = hostname.replace(/^\[|\]$/g, "");

  if (isIP(host)) {
    if (isBlockedIp(host)) {
      throw new UrlValidationError(
        "Private or reserved addresses are blocked.",
        403,
      );
    }
    return [{ address: host, family: isIP(host) }];
  }

  let records;
  try {
    records = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new UrlValidationError("Could not resolve this hostname.");
  }

  const publicRecords = records.filter(
    (record) => record?.address && !isBlockedIp(record.address),
  );

  if (publicRecords.length === 0) {
    throw new UrlValidationError(
      "This host resolves only to private or reserved addresses.",
      403,
    );
  }

  return publicRecords;
}

export async function assertSafeTarget(raw) {
  const url = normalizeTargetUrl(raw);
  const addresses = await resolvePublicAddresses(url.hostname);
  return { url, addresses };
}
