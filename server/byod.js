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

const DEFAULT_HINTS = {
  "incog.ignorelist.com": {
    cname: "3j6hiavn.up.railway.app",
    txtName: "_railway-verify.incog",
    txtHost: "_railway-verify.incog.ignorelist.com",
    txt: "railway-verify=06f85953454d1d0fe4ce86fb8af92dd9055a065f5a204fa2527f0b777d4cd598",
  },
};

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

export async function targetARecords(target = CNAME_TARGET) {
  try {
    return [...new Set(await resolve4(stripDot(target)))];
  } catch {
    return [];
  }
}

export async function domainPointsAtTarget(domain, target = CNAME_TARGET) {
  const want = stripDot(target);
  try {
    const cnames = await resolveCname(domain);
    if (
      cnames.some((name) => {
        const n = stripDot(name);
        return n.endsWith(".up.railway.app");
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
  const projectToken = process.env.RAILWAY_PROJECT_TOKEN;
  const token = process.env.RAILWAY_TOKEN || process.env.RAILWAY_API_TOKEN;
  const projectId = process.env.RAILWAY_PROJECT_ID;
  const environmentId = process.env.RAILWAY_ENVIRONMENT_ID;
  const serviceId = process.env.RAILWAY_SERVICE_ID;
  if ((!token && !projectToken) || !projectId || !environmentId || !serviceId) {
    return null;
  }
  return { token, projectToken, projectId, environmentId, serviceId };
}

export function byodHints() {
  let extra = {};
  try {
    extra = JSON.parse(process.env.INCOG_BYOD_HINTS || "{}");
  } catch {
    extra = {};
  }
  return { ...DEFAULT_HINTS, ...extra };
}

export function recordsForDomain(domain) {
  const hint = byodHints()[stripDot(domain)];
  if (!hint) return null;
  return {
    cname: hint.cname,
    txtName: hint.txtName,
    txtHost: hint.txtHost,
    txt: hint.txt,
  };
}

export function byodSetupMessage({ domain, attached, verified, train404, records }) {
  if (verified) {
    return `https://${domain} is live.`;
  }
  if (records?.cname && records?.txt) {
    const delA = train404
      ? "Railway’s train 404 means the A record hit the edge without a verified custom domain. Delete that A record. "
      : "";
    return `${delA}Add CNAME ${domain} → ${records.cname} and TXT ${records.txtName} → ${records.txt}. If FreeDNS says CNAME is restricted, use Dynu for the CNAME (A records will keep showing the train page).`;
  }
  if (attached) {
    return `https://${domain} is on Railway. Set the CNAME and TXT Railway shows for this hostname, then wait for TLS.`;
  }
  return `DNS is not enough. Custom domains need a Railway CNAME plus TXT, not an A record to ${CNAME_TARGET}.`;
}

async function railwayGraphql(query, variables) {
  const cfg = railwayConfig();
  if (!cfg) return null;
  const headers = { "content-type": "application/json" };
  if (cfg.projectToken) {
    headers["Project-Access-Token"] = cfg.projectToken;
  } else {
    headers.authorization = `Bearer ${cfg.token}`;
  }
  const res = await fetch("https://backboard.railway.com/graphql/v2", {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

function recordsFromStatus(domain, status) {
  if (!status) return recordsForDomain(domain);
  const cname = status.dnsRecords?.find(
    (row) => row.recordType === "DNS_RECORD_TYPE_CNAME",
  );
  const txt = status.verificationToken || status.verification?.token;
  const txtName = status.verificationDnsHost || status.verification?.dnsHost;
  if (!cname?.requiredValue || !txt) return recordsForDomain(domain);
  return {
    cname: stripDot(cname.requiredValue),
    txtName,
    txtHost: txtName?.includes(".")
      ? `${txtName}.${domain.split(".").slice(-2).join(".")}`
      : `${txtName}.${domain.split(".").slice(1).join(".")}`,
    txt,
  };
}

export async function attachRailwayDomain(domain) {
  const cfg = railwayConfig();
  if (!cfg) {
    return { attached: false, reason: "not_configured", records: recordsForDomain(domain) };
  }
  const created = await railwayGraphql(
    `mutation ($input: CustomDomainCreateInput!) {
      customDomainCreate(input: $input) {
        id
        domain
        status {
          dnsRecords { recordType requiredValue hostlabel }
          verificationToken
          verificationDnsHost
          verified
          certificateStatus
        }
      }
    }`,
    {
      input: {
        domain,
        projectId: cfg.projectId,
        environmentId: cfg.environmentId,
        serviceId: cfg.serviceId,
      },
    },
  );
  if (created?.errors?.length) {
    const message = created.errors[0]?.message || "Railway rejected the domain";
    if (!/already exists|duplicate/i.test(message)) {
      throw new Error(message);
    }
  } else if (created?.data?.customDomainCreate) {
    const row = created.data.customDomainCreate;
    return {
      attached: true,
      reason: "created",
      id: row.id,
      verified: Boolean(row.status?.verified),
      records: recordsFromStatus(domain, row.status),
    };
  }

  const listed = await railwayGraphql(
    `query ($projectId: String!, $environmentId: String!, $serviceId: String!) {
      domains(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId) {
        customDomains {
          id
          domain
          status {
            dnsRecords { recordType requiredValue hostlabel }
            verificationToken
            verificationDnsHost
            verified
            certificateStatus
          }
        }
      }
    }`,
    {
      projectId: cfg.projectId,
      environmentId: cfg.environmentId,
      serviceId: cfg.serviceId,
    },
  );
  const match = listed?.data?.domains?.customDomains?.find(
    (row) => stripDot(row.domain) === stripDot(domain),
  );
  if (match) {
    return {
      attached: true,
      reason: "exists",
      id: match.id,
      verified: Boolean(match.status?.verified),
      records: recordsFromStatus(domain, match.status),
    };
  }
  return { attached: false, reason: "missing", records: recordsForDomain(domain) };
}
