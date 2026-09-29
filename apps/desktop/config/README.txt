本目录由 apps/desktop/scripts/embed-key.mjs 生成/维护：

· E:\可视化编辑器\apps\desktop\config\app-config.example.json
    明文源（改这里）。update.baseUrl / mcp.httpPort 等都在里面。
· E:\可视化编辑器\var\keys\config.key
    AES-256-GCM 密钥（base64 的 32 字节）。随包分发，不是秘密。
· E:\可视化编辑器\apps\desktop\config\app-config.enc
    **应用真正读的加密配置**。换地址 = 重新生成这个文件并替换掉。
· E:\可视化编辑器\apps\desktop\config\buildKey.mjs
    构建期兜底密钥（应用找不到 config.key 时用它）。

重新生成：node scripts/embed-key.mjs [--rotate]
手动验证：node E:\可视化编辑器\tools\secure-config\secure-config.mjs verify E:\可视化编辑器\apps\desktop\config\app-config.enc --key-file E:\可视化编辑器\var\keys\config.key
