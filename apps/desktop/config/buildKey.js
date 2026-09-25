/**
 * 构建期兜底密钥（由 tools/secure-config 的 embed-key 生成；⚠ 随包分发 = 只能算"防误改"，不是安全边界）
 * 想换密钥：重新 keygen → embed-key → 用新密钥重新加密 app-config.enc。
 */
export const BUILD_CONFIG_KEY = '28o49GpnWF/F9OM909J327K5tzQ18w3BaOAWwcWylQI=';
/** 这份密钥的指纹（换密钥时一眼能看出配置是不是配套的） */
export const BUILD_KEY_FINGERPRINT = 'dc74a28cb352';
