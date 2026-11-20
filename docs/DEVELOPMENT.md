# 开发

使用Node.js 24，运行npm ci安装开发依赖。npm run build构建，npm test、npm run lint及npm run check进行检查，npm run package生成本地安装目录。

`npm run lint:review` 使用类型与 Obsidian 推荐检查，按规则输出警告数量，并保存 `test-results/warnings-review.json`。正常 lint 负责阻止错误；review 保留尚未迁移的类型与设置搜索警告。`types/` 中的数据和桌面 API 声明只参与开发检查，不增加运行依赖。

安装文件为main.js、manifest.json、styles.css。构建结果及测试产物不提交凭据与日志。音频校准需要Python、NumPy和FFmpeg。发布标签与manifest版本一致。

音频脚本内置于 main.js，校准时自动写入插件目录。完整状态保存在插件目录 data.json，迁移时保留该文件。

发布版本需要同步 package.json、package-lock.json、manifest.json、versions.json、中英文 README 和 CHANGELOG。更新日期由 package.json 的 releaseDate 提供，构建时写入设置底部，检查脚本验证这些文件一致。
