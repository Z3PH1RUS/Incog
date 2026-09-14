import { resolve4, resolveCname } from "node:dns/promises";

const HOSTNAME =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

export const CNAME_TARGET = (
  process.env.INCOG_CNAME_TARGET || "incog-production-591c.up.railway.app"
)
  .replace(/^https?:\/\//i, "")
  .replace(/\.$/, "")
  .replace(/\/.*$/, "")
  .toLowerCase();

export function parseByodDomain(raw) {
  let value = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "");
  value = value.split("/")[0].split(":")[0].replace(/\.$/, "");
  if (!HOSTNAME.test(value)) {
    throw new Error("Enter a full domain like proxy.example.com");
  }
  if (value === CNAME_TARGET || value.endsWith(".up.railway.app")) {
    throw new Error("That is already the Incog host. Use your own domain.");
  }
  return value;
}

function stripDot(host) {
  return String(host || "")
    .replace(/\.$/, "")
    .toLowerCase();
}

export async function domainPointsAtTarget(domain, target = CNAME_TARGET) {
  const want = stripDot(target);
  try {
    const cnames = await resolveCname(domain);
    if (
      cnames.some((name) => {
        const n = stripDot(name);
        return n === want || n.endsWith(`.${want}`);
      })
    ) {
      return "cname";
    }
  } catch {
    // Apex records are often flattened; fall through to A comparison.
  }

  try {
    const [theirs, ours] = await Promise.all([
      resolve4(domain),
      resolve4(want),
    ]);
    if (theirs.some((ip) => ours.includes(ip))) return "a";
  } catch {
    // ignore
  }
  return null;
}

export function railwayConfig() {
  const token = process.env.RAILWAY_TOKEN || process.env.RAILWAY_API_TOKEN;
  const projectId = process.env.RAILWAY_PROJECT_ID;
  const environmentId = process.env.RAILWAY_ENVIRONMENT_ID;
  const serviceId = process.env.RAILWAY_SERVICE_ID;
  if (!token || !projectId || !environmentId || !serviceId) return null;
  return { token, projectId, environmentId, serviceId };
}

export async function attachRailwayDomain(domain) {
  const cfg = railwayConfig();
  if (!cfg) {
    return { attached: false, reason: "not_configured" };
  }
  const res = await fetch("https://backboard.railway.com/graphql/v2", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${cfg.token}`,
    },
    body: JSON.stringify({
      query: `mutation ($input: CustomDomainCreateInput!) {
        customDomainCreate(input: $input) { id domain }
      }`,
      variables: {
        input: {
          domain,
          projectId: cfg.projectId,
          environmentId: cfg.environmentId,
          serviceId: cfg.serviceId,
        },
      },
    }),
  });
  const body = await res.json();
  if (body.errors?.length) {
    const message = body.errors[0]?.message || "Railway rejected the domain";
    if (/already exists|duplicate/i.test(message)) {
      return { attached: true, reason: "exists" };
    }
    throw new Error(message);
  }
  return { attached: true, reason: "created", id: body.data?.customDomainCreate?.id };
}
