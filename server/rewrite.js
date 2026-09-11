import * as cheerio from "cheerio";

const REWRITABLE_ATTRS = [
  ["a", "href"],
  ["area", "href"],
  ["link", "href"],
  ["base", "href"],
  ["img", "src"],
  ["source", "src"],
  ["video", "src"],
  ["video", "poster"],
  ["audio", "src"],
  ["script", "src"],
  ["iframe", "src"],
  ["embed", "src"],
  ["object", "data"],
  ["form", "action"],
  ["input", "src"],
  ["input", "formaction"],
  ["button", "formaction"],
  ["track", "src"],
  ["use", "href"],
  ["image", "href"],
];

const SRCSET_ATTRS = [
  ["img", "srcset"],
  ["source", "srcset"],
  ["link", "imagesrcset"],
];

export function toProxyPath(targetHref, baseHref) {
  if (targetHref == null) return targetHref;

  const raw = String(targetHref).trim();
  if (!raw || raw.startsWith("data:") || raw.startsWith("blob:") || raw.startsWith("mailto:") || raw.startsWith("javascript:") || raw.startsWith("#")) {
    return raw;
  }

  try {
    const resolved = new URL(raw, baseHref);
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
      return raw;
    }
    return `/proxy?url=${encodeURIComponent(resolved.href)}`;
  } catch {
    return raw;
  }
}

export function rewriteSrcset(value, baseHref) {
  return String(value)
    .split(",")
    .map((part) => {
      const trimmed = part.trim();
      if (!trimmed) return "";
      const [url, ...rest] = trimmed.split(/\s+/);
      return [toProxyPath(url, baseHref), ...rest].join(" ");
    })
    .filter(Boolean)
    .join(", ");
}

export function rewriteCss(css, baseHref) {
  return String(css).replace(
    /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi,
    (match, quote, url) => {
      const trimmed = url.trim();
      if (!trimmed || trimmed.startsWith("data:") || trimmed.startsWith("#")) {
        return match;
      }
      return `url(${quote}${toProxyPath(trimmed, baseHref)}${quote})`;
    },
  );
}

export function rewriteHtml(html, baseHref) {
  const $ = cheerio.load(html, { decodeEntities: false });

  $("base").remove();

  for (const [tag, attr] of REWRITABLE_ATTRS) {
    $(`${tag}[${attr}]`).each((_, el) => {
      const value = $(el).attr(attr);
      $(el).attr(attr, toProxyPath(value, baseHref));
    });
  }

  for (const [tag, attr] of SRCSET_ATTRS) {
    $(`${tag}[${attr}]`).each((_, el) => {
      $(el).attr(attr, rewriteSrcset($(el).attr(attr), baseHref));
    });
  }

  $("[style]").each((_, el) => {
    $(el).attr("style", rewriteCss($(el).attr("style"), baseHref));
  });

  $("style").each((_, el) => {
    $(el).text(rewriteCss($(el).html() || "", baseHref));
  });

  $('meta[http-equiv="refresh" i]').each((_, el) => {
    const content = $(el).attr("content") || "";
    $(el).attr(
      "content",
      content.replace(/url\s*=\s*([^\s;]+)/i, (_, url) => {
        const cleaned = url.replace(/^['"]|['"]$/g, "");
        return `url=${toProxyPath(cleaned, baseHref)}`;
      }),
    );
  });

  $("head").prepend(
    `<script>document.documentElement.dataset.incog="1"</script>`,
  );

  return $.html();
}
