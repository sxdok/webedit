/**
 * 更新接口（**预留**）：只做"查有没有新版 + 打开下载地址"，把真正的下载/安装留成挂点。
 *
 * 用户要求：「分发版预留更新接口，接口地址使用加密配置文件保存以备后续更改」。
 * 所以：
 *   · 更新服务器地址与清单文件名**只从加密配置里读**（`update.baseUrl` / `update.manifest`）——
 *     换地址 = 重新加密一份 `app-config.enc` 替换掉，**不用改代码、不用重新打包**；
 *   · 检查流程：GET `<baseUrl><manifest>` → 比对版本 → 有新版则给出下载地址；
 *   · 「安装」这一步**故意不实现**（写成 `install()` 的空挂点 + 明确返回值），
 *     因为静默升级涉及签名与权限，属于后续要跟用户确认的事；现在只把用户送到下载地址。
 *
 * 清单（`latest.json`）约定：
 *   {
 *     "version": "0.2.0", "publishedAt": "2026-09-25T10:00:00Z", "notes": "…",
 *     "mandatory": false, "minVersion": "0.1.0",
 *     "download": { "url": "https://…/app-0.2.0.exe", "sizeBytes": 0, "sha256": "…" },
 *     "channels": { "beta": { "version": "0.3.0-beta.1", "download": { "url": "…" } } }
 *   }
 * `channels[<channel>]` 会覆盖顶层同名字段（灰度/内测用），通道名来自配置的 `update.channel`。
 */

const isHttpUrl = (s) => /^https?:\/\/[^\s]+$/i.test(String(s ?? ''));

/** 版本比较：数字段逐个比，预发布版本小于同号正式版（`1.0.0-beta < 1.0.0`） */
export function compareVersions(a, b) {
  const parse = (v) => {
    const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?/.exec(String(v ?? '').trim());
    if (!m) return null;
    return { nums: [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)], pre: m[4] ?? null };
  };
  const A = parse(a);
  const B = parse(b);
  if (!A || !B) return null; // 有一边不是版本号 → 由调用方决定怎么处理
  for (let i = 0; i < 3; i += 1) if (A.nums[i] !== B.nums[i]) return A.nums[i] > B.nums[i] ? 1 : -1;
  if (A.pre === B.pre) return 0;
  if (A.pre === null) return 1;
  if (B.pre === null) return -1;
  return A.pre > B.pre ? 1 : -1;
}

export function createUpdater({ config, currentVersion, logger, openExternal, fetchImpl }) {
  const doFetch = fetchImpl ?? globalThis.fetch;
  let last = { status: 'not-checked', currentVersion, checkedAt: null };
  let inFlight = null;

  const manifestUrl = () => new URL(String(config.manifest), String(config.baseUrl)).href;

  async function fetchManifest(url) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), config.timeoutMs);
    try {
      const res = await doFetch(url, { signal: ctl.signal, headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`清单不是合法 JSON（前 80 字：${text.slice(0, 80)}）`);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  /** 通道覆盖：`channels[channel]` 里的字段优先 */
  function applyChannel(manifest) {
    const ch = config.channel;
    if (!ch || !manifest?.channels || typeof manifest.channels !== 'object') return manifest;
    const over = manifest.channels[ch];
    if (!over || typeof over !== 'object') return manifest;
    return { ...manifest, ...over, channels: manifest.channels };
  }

  /**
   * 检查更新。**不抛异常**，把失败写进结果的 `error`（菜单点击后要能弹出人话）。
   * @returns {Promise<object>}
   */
  async function check({ channel } = {}) {
    if (channel) config.channel = channel;
    const base = { currentVersion, channel: config.channel, manifestUrl: manifestUrl(), checkedAt: new Date().toISOString() };
    if (!config.enabled) {
      last = { ...base, status: 'disabled', note: '配置里 update.enabled=false' };
      return last;
    }
    if (!isHttpUrl(config.baseUrl)) {
      last = { ...base, status: 'error', error: `update.baseUrl 不是 http(s) 地址：${config.baseUrl}` };
      return last;
    }
    try {
      const raw = await fetchManifest(base.manifestUrl);
      const manifest = applyChannel(raw);
      const latest = String(manifest?.version ?? '').trim();
      const cmp = compareVersions(latest, currentVersion);
      if (!latest || cmp === null) {
        last = { ...base, status: 'error', error: `清单里的 version 不是合法版本号：${JSON.stringify(manifest?.version)}` };
      } else {
        const downloadUrl = manifest?.download?.url ?? manifest?.url ?? null;
        const hasNewer = cmp > 0;
        if (hasNewer && !config.allowPrerelease && /-/.test(latest)) {
          last = { ...base, status: 'up-to-date', latestVersion: latest, note: `发现预发布版本 ${latest}，配置不允许预发布（update.allowPrerelease=false），已忽略` };
        } else if (hasNewer && !isHttpUrl(downloadUrl)) {
          last = { ...base, status: 'error', error: `清单说有新版本 ${latest}，但 download.url 不是 http(s) 地址：${downloadUrl}` };
        } else if (hasNewer) {
          last = {
            ...base,
            status: 'update-available',
            latestVersion: latest,
            publishedAt: manifest?.publishedAt ?? null,
            notes: manifest?.notes ?? '',
            mandatory: Boolean(manifest?.mandatory),
            minVersion: manifest?.minVersion ?? null,
            sizeBytes: manifest?.download?.sizeBytes ?? null,
            sha256: manifest?.download?.sha256 ?? null,
            downloadUrl,
          };
        } else {
          last = { ...base, status: 'up-to-date', latestVersion: latest };
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      last = { ...base, status: 'error', error: /abort/i.test(msg) ? `请求超时（${config.timeoutMs}ms）` : msg };
    }
    logger?.[last.status === 'error' ? 'error' : 'info'](
      `检查更新：${last.status}（当前 ${currentVersion}${last.latestVersion ? ` / 最新 ${last.latestVersion}` : ''}${last.error ? ` / ${last.error}` : ''}）`,
    );
    return last;
  }

  /** 同一个结果反复点不要打两次网络请求 */
  function checkOnce() {
    if (!inFlight) {
      inFlight = check().finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  }

  /** 打开下载地址（http/https 才允许，防配置文件被改成 file:// 或自定义协议） */
  async function openDownload() {
    const url = last?.downloadUrl;
    if (!isHttpUrl(url)) return { ok: false, error: '当前没有可用的下载地址（请先点「检查更新」）' };
    try {
      await openExternal(url);
      logger?.info(`已在系统里打开下载地址：${url}`);
      return { ok: true, url };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * 安装挂点（**故意留空**）：
   * 目前把用户送到下载地址由他自己装；将来要静默升级，就在这里接入下载 + 校验 sha256 + 调用安装器。
   */
  async function install() {
    return {
      ok: false,
      reserved: true,
      error: '自动安装尚未实现（预留接口）：请用「打开下载页」手动下载安装包',
      pickedUpFrom: last?.downloadUrl ?? null,
    };
  }

  return { check, checkOnce, openDownload, install, status: () => last, manifestUrl };
}
