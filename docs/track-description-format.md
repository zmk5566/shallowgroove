# 双语轨道描述 JSON

`track-descriptions/*.json` 是可供界面和未来 agent 读取的语义描述，不包含数万条 MIDI 演奏事件。原始事件继续保存在 `demo-projects/*.json`；二者按稳定的轨道 `id` 关联。音轨顺序、通道和音符不因翻译而改变。

## 文件

- `track-descriptions/DaisyBell.json` 与 `track-descriptions/Korobeiniki.json` 分别描述三轨与四轨示例。
- `schemas/track-descriptions.schema.json`：JSON Schema 2020-12，描述格式版本 1。

## 字段约定

| 字段 | 含义 |
|---|---|
| schema_version | 数据结构版本，目前为 1 |
| default_locale / supported_locales | 默认 zh-CN，支持 zh-CN 和 en |
| source_midi | 原 MIDI 相对路径与 SHA256 |
| tracks[].id | 与项目事件数据关联的稳定 ID，不随语言变化 |
| name / description | `{"zh-CN":"…","en":"…"}` 多语言文本 |
| source | 从事件中解码的音色、Program、Bank、鼓映射与统计 |
| musical_role | 编曲角色，明确区分 inferred 与 unknown；不是 MIDI 原文 |
| faust.initial_assignment | 指向共享 faust_instruments 定义的初始音色 ID |
| faust.match_to_source | 当前 not_matched，不能视作原曲音色还原 |
| faust.proposal | 未实现的音色设计建议，不包含可执行 DSP |
| faust_instruments | 共享初始 DSP 的路径、SHA256、通道数、复音和双语参数说明 |

Program 原始值为 0–127，界面显示加 1。鼓通道不使用旋律音色名称解释 Program。GS Bank 变体保留编号，并标记 exact name 尚未核实。

Faust 参数的 `id` 是描述 ID，`faust_label` 是与初始 DSP 关联的标签；真实参数地址必须从编译后的 Faust UI 元数据取得。JSON 中的路径相对于描述文件所在目录。DSP 的 SHA256 用于识别静态描述是否过期，不是可执行代码的授权机制。

Faust 信息描述初始项目配置。用户在界面中重编译后的源码和参数不会自动写回这些文件；项目保存和编译结果同步将在后续实现。proposal 中的分类仅为后续设计方向，不代表 agent 已经生成了相应音色。

## 界面与语言回退

右上角语言选择器切换轨道名称、轨道说明、角色及 Faust 参数标签/说明，偏好保存在本地。此轮 i18n 范围是轨道描述与初始 Faust 元数据，应用外壳按钮尚未全部翻译。顺序为请求语言 → zh-CN → en → 调用方占位文本。

## 生成与验证

```sh
python3 tools/import_demos.py
npm test
npm run build
```

导入器使用 `tools/midi_labels.py` 解码原始音色，再用 `tools/track_descriptions.py` 生成双语文件。重新导入会覆盖生成的描述 JSON；长期修改应改生成器，手工编辑则需另存副本。Schema 校验、跨文件轨道 ID、DSP SHA256 和语言回退由测试验证。
