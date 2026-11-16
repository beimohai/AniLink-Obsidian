# 开发验证

使用 Node.js 24 与锁文件执行 npm ci、npm run build、npm run lint、npm test、npm run check、npm run package。音频算法另外运行 python tests/test_audio_alignment.py，需要 NumPy。CI 同时运行 JavaScript 和 Python 回归测试。

测试覆盖订阅规则、季度与分集匹配、离线进度、清理保护、同名脚本内置、构建复现、存储迁移、移动端导入边界和逐字段合并。音频测试覆盖尾部拼接、异常点重采样、短音频和无关音轨拒绝。

真实服务测试在自己的专用库进行，凭据、日志、截图和结果保存在已忽略目录或仓库外。部署替换 main.js、manifest.json、styles.css，保留 data.json。

Windows 上已进行设置布局、观看进度、遗留文件清理和片头音频校准验证。实体手机、macOS、Linux、受认证保护的远程视频及所有第三方播放器组合仍需对应设备验证。
