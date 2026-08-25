(function installMainImageCore(root) {
  function normalizedImageUrl(rawUrl) {
    try {
      const url = new URL(String(rawUrl || "").trim());
      const hostname = url.hostname.toLowerCase();
      const isOzonImageHost = hostname === "ozone.ru" || hostname.endsWith(".ozone.ru") || hostname === "ozon.ru" || hostname.endsWith(".ozon.ru");
      if (url.protocol !== "https:" || !isOzonImageHost || !/^\/s3\/multimedia-/i.test(url.pathname)) return "";
      url.hash = "";
      return url.toString();
    } catch {
      return "";
    }
  }

  function sourcePriority(source) {
    if (source === "og:image") return 6000;
    if (source === "jsonld") return 5500;
    if (source === "gallery") return 5000;
    if (source === "picture") return 3500;
    return 1000;
  }

  function resolutionHint(url) {
    const match = String(url || "").match(/\/(?:wc|wh|w)(\d{2,5})\//i);
    return match ? Math.min(3000, Number(match[1]) || 0) : 0;
  }

  function chooseBestCandidate(candidates) {
    const unique = new Map();
    for (const candidate of Array.isArray(candidates) ? candidates : []) {
      const url = normalizedImageUrl(candidate?.url);
      if (!url) continue;
      const width = Math.max(0, Number(candidate.width) || 0, Number(candidate.naturalWidth) || 0);
      const height = Math.max(0, Number(candidate.height) || 0, Number(candidate.naturalHeight) || 0);
      const visibleBonus = candidate.visible === false ? 0 : 300;
      const sizeScore = Math.min(2500, Math.sqrt(width * height || 0));
      const score = sourcePriority(candidate.source) + visibleBonus + sizeScore + resolutionHint(url);
      const normalized = { url, source: String(candidate.source || "image"), width, height, score };
      if (!unique.has(url) || unique.get(url).score < score) unique.set(url, normalized);
    }
    return [...unique.values()].sort((a, b) => b.score - a.score)[0] || null;
  }

  root.OzonMainImageCore = { normalizedImageUrl, chooseBestCandidate };
})(globalThis);
