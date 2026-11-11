# 开发

使用Node.js 24，运行npm ci安装开发依赖。npm run build构建，npm test、npm run lint及npm run check进行检查，npm run package生成本地安装目录。

安装文件为main.js、manifest.json、styles.css。构建结果及测试产物不提交凭据与日志。音频校准需要Python、NumPy和FFmpeg。发布标签与manifest版本一致。

音频脚本内置于 main.js，校准时自动写入插件目录。完整状态保存在插件目录 data.json，迁移时保留该文件。
