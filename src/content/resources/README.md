# Resource Catalog & Hub

## Responsibility
负责 Setup Center 的外部开发资源、精选工具、设计系统、开源模版与学习资料元数据管理。
为开发者提供高质量的 "Everything Needed to Build" 启动清单。

## Structure
```
src/content/resources/
├── README.md
├── types.ts          # ResourceItem, ResourceCategory, ResourceActionType 定义
├── index.ts          # 聚合导出、分类元数据与检索 API
└── categories/
    ├── frontend.ts   # 顶级 Web 界面与排版灵感画廊
    ├── components.ts # 现代组件库与无头状态原语
    ├── animation.ts  # 动效引擎、物理弹簧与 Three.js
    ├── icons.ts      # 开源矢量图标系统
    ├── fonts.ts      # 开发者代码与排印字体
    ├── tools.ts      # 开发效率工具与终端利器
    ├── ai.ts         # 本地 AI、MCP 与提示词体系
    ├── templates.ts  # 现代工程模版与脚手架
    ├── learning.ts   # 技能路线图与名校公开课
    └── collections.ts# 长期精选 Awesome 清单与自建服务
```

## Adding a Resource（新增一个资源）
1. 找到对应的类别文件（如 `src/content/resources/categories/tools.ts`）。
2. 在数组中增加一个符合 `ResourceItem` 格式的对象：
   ```ts
   {
     id: "res:my-tool",
     name: "My Tool",
     category: "tools",
     description: "一句话准确描述该工具的作用。",
     recommendedReason: "为什么推荐它，给开发者带来什么真实价值。",
     author: "Author or Org",
     tags: ["标签1", "标签2"],
     actionType: "github", // "github" | "external" | "download"
     repository: "https://github.com/...",
     homepage: "https://...",
     stars: "10k+",
     license: "MIT",
   }
   ```
3. **无需修改**任何 UI 页面！Resource Center 会自动渲染新卡片，支持分类过滤、实时关键字搜索与外部链接跳转。
