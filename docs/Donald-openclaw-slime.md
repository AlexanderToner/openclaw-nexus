# OpenClaw 下一代架构：TaskGraph-Agent 完整技术设计文档

**版本**: 2.0  
**最后更新**: 2026-03-29  
**状态**: 可落地实施

---

## 文档目录

1. [架构概述](#1-架构概述)
2. [核心设计原则](#2-核心设计原则)
3. [系统分层设计](#3-系统分层设计)
   - 3.1 用户接口层
   - 3.2 协议适配层
   - 3.3 Viking 路由层 + Security Arbiter
   - 3.4 任务管理层（TaskGraph）
   - 3.5 SubAgent 执行层
   - 3.6 GUI 原子执行引擎
   - 3.7 全局状态中心（Global State Store）
   - 3.8 安全沙箱层
   - 3.9 基础设施层
4. [核心机制详解](#4-核心机制详解)
   - 4.1 TaskGraph 可重规划（Partial Replan）
   - 4.2 GUI Precondition/PostVerify 轻量校验
   - 4.3 Goal Assertion 目标断言
   - 4.4 错误三分类与熔断策略
   - 4.5 结构化遥测与调试支持
5. [数据模型定义](#5-数据模型定义)
6. [API 接口规范](#6-api-接口规范)
7. [配置参考](#7-配置参考)
8. [执行流程示例](#8-执行流程示例)
9. [性能优化指南](#9-性能优化指南)
10. [安全加固清单](#10-安全加固清单)
11. [实施路线图](#11-实施路线图)
12. [附录：故障排查手册](#12-附录故障排查手册)

---

## 1. 架构概述

### 1.1 定位

**本地优先、任务树驱动、主从多智能体、沙箱隔离、GUI原子化、强结束规则的电脑自动化执行引擎。**

### 1.2 目标

- 彻底解决 OpenClaw 原版的 **Token 爆炸、死循环、不可结束、GUI混乱、错误雪崩** 等顽疾
- Token 消耗降低 **80%~95%**
- 死循环概率趋近于 **0**
- 任务可追踪、可调试、可审计
- 支持复杂多步骤任务的可靠执行

### 1.3 总体架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          用户接口层 (Interaction Layer)                      │
│   飞书 │ 钉钉 │ QQ │ Discord │ Telegram │ Web UI │ CLI/TUI │ WebSocket API  │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        协议适配层 (Protocol Adapter)                         │
│              将异构消息统一为 MsgContext，隔离平台差异                        │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                 Viking 路由层 + Security Arbiter（前置安全仲裁）             │
│  轻量模型意图识别 → 工具/文件/Skill 筛选 → 路径/命令白名单校验 → 权限叠加检查 │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      任务管理层 (TaskGraph Layer) ★核心                      │
│  主Agent一次性拆解 → TaskGraph（含Goal Assertion）→ 执行中支持Partial Replan │
│                    → 硬性结束规则 + 目标断言校验                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       SubAgent 执行层 + 全局状态中心                          │
│  FileAgent │ ShellAgent │ GuiAgent │ BrowserAgent │ 专用SubAgent池          │
│  每个SubAgent原子执行 → 独立上下文 → 通过Global State Store通信              │
│                → 错误三分类 + 熔断 → 干完即销毁                               │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     GUI原子执行引擎（带Precondition/PostVerify）             │
│        全局操作队列 → 前置条件检查 → 刚性执行 → 后置校验 → 失败重规划         │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          安全沙箱层 (Sandbox Layer)                          │
│        文件白名单 │ 路径隔离 │ GUI权限独立 │ 操作全链路可追溯                │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        基础设施层 (Infrastructure)                           │
│   配置管理 │ 结构化日志(OpenTelemetry) │ 记忆检索(ContextEngine) │ 事件总线  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. 核心设计原则

| 原则 | 说明 |
|------|------|
| **规划与执行分离** | 主Agent只做规划，不操作任何工具；SubAgent只做执行，不决策 |
| **上下文分片** | 每步只传必要信息，历史仅传摘要，Token消耗降低80%+ |
| **硬性结束规则** | 不依赖LLM判断完成，靠步数/Token/超时/完成状态硬性终止 |
| **原子化操作** | GUI操作为刚性指令，带前置/后置校验，不循环试探 |
| **失败隔离** | SubAgent失败不影响主Agent状态，可独立重试或跳过 |
| **最小权限** | 每个操作遵循最小权限原则，安全仲裁层强制校验 |
| **可观测性** | 全链路结构化日志，支持OpenTelemetry和Grafana可视化 |

---

## 3. 系统分层设计

### 3.1 用户接口层

保持OpenClaw现有通道生态，所有通道通过插件化方式接入。

**支持通道**:
- 即时通讯: 飞书、钉钉、QQ、Discord、Telegram、Slack
- 原生接口: Web UI、CLI、TUI、WebSocket API

**通道插件接口**:
```typescript
interface ChannelPlugin {
  name: string;
  sendMessage(sessionId: string, content: string): Promise<void>;
  receiveMessage(callback: (msg: MsgContext) => void): void;
  // ... 其他生命周期方法
}
```

### 3.2 协议适配层

将各通道原始消息清洗为统一 `MsgContext`。

**MsgContext 定义**:
```typescript
interface MsgContext {
  id: string;                      // 唯一消息ID
  body: string;                    // 消息正文（已清洗）
  sessionKey: string;              // 会话标识（用于状态隔离）
  provider: string;                // 来源平台（feishu/dingtalk/...）
  chatType: "direct" | "group";    // 聊天类型
  senderId?: string;               // 发送者ID
  senderName?: string;             // 发送者名称
  timestamp: number;               // 接收时间戳（毫秒）
  metadata?: Record<string, any>;  // 扩展元数据
}
```

### 3.3 Viking 路由层 + Security Arbiter（前置安全仲裁）

#### 3.3.1 Viking 路由职责

- 使用轻量本地模型（如 GLM-4.7-Flash / Ollama 加载的 4B 模型）快速判断用户意图
- 根据意图**只加载**必要的工具定义、上下文文件、Skill 摘要
- 输出 `RouteDecision` 结构，供后续层使用

**RouteDecision 定义**:
```typescript
interface RouteDecision {
  intent: string;                  // 意图分类: file_ops / gui_auto / browser / chat / code
  requiredTools: string[];         // 需要加载的工具列表
  requiredFiles: string[];         // 需要加载的上下文文件（如 AGENTS.md 部分章节）
  requiredSkills: string[];        // 需要加载的Skill
  confidence: number;              // 置信度 0-1
}
```

**性能数据**:
- 简单对话（“你好”）：原 15,466 tokens → 路由后约 1,021 tokens（节省 93%）
- 文件操作：原 15,466 tokens → 路由后约 3,058 tokens（节省 80%）

#### 3.3.2 Security Arbiter 职责

在路由决策后、实际执行前，强制执行安全校验。

**校验规则配置** (`security_policy.yaml`):
```yaml
file_operations:
  allowed_paths:
    - "~/Desktop"
    - "~/Documents"
    - "~/Downloads"
    - "/tmp/openclaw-workspace"
  blocked_paths:
    - "/etc"
    - "/System"
    - "~/.ssh"
    - "/usr"
  allowed_extensions: [".txt", ".md", ".pdf", ".jpg", ".png", ".csv", ".log"]
  blocked_extensions: [".exe", ".sh", ".py", ".js", ".vbs"]
  max_file_size_mb: 100

shell_commands:
  allowed_commands:
    - "ls"
    - "mv"
    - "cp"
    - "mkdir"
    - "rm"          # 仅限工作目录内
    - "cat"
    - "grep"
  blocked_patterns:
    - "rm -rf /"
    - "sudo"
    - "chmod 777"
    - "> /dev/sda"
  max_output_size_bytes: 1_000_000

network:
  allowed_domains:
    - "api.openai.com"
    - "api.anthropic.com"
    - "github.com"
    - "raw.githubusercontent.com"
  blocked_ports: [22, 23, 445, 3389]
  allow_localhost: true

skills:
  max_per_agent: 3
  dangerous_skills:
    - "delete_all_files"
    - "send_email"
    - "post_http"
    - "format_disk"
    - "require_user_approval"   # 标记需要用户二次确认
```

**仲裁流程**:
```
RouteDecision → Arbiter.check():
  1. 路径校验：所有文件操作路径是否在 allowed_paths 内且不在 blocked_paths
  2. 命令校验：shell 命令是否在 allowed_commands 且不匹配 blocked_patterns
  3. 网络校验：目标域名/IP 是否允许
  4. 技能权限叠加：多个技能组合是否超过 max_per_agent 或包含危险组合
  5. 若任一失败：返回安全拒绝错误，不进入任务管理层
```

**用户二次确认**（针对 dangerous_skills）:
- 系统发送交互式卡片（飞书/钉钉/Discord）等待用户确认
- 确认通过后生成临时 token 放行本次操作
- 超时（5分钟）未确认则任务自动取消

### 3.4 任务管理层（TaskGraph Layer）

#### 3.4.1 主Agent职责

- 接收路由后的用户意图
- **只调用1次LLM** 生成完整的 TaskGraph（含 Goal Assertion）
- 将 TaskGraph 持久化到会话存储
- 调度 SubAgent 执行每个 Step
- 收集执行结果，更新 TaskGraph 状态
- 触发 Partial Replan（当步骤失败或目标断言不满足）
- 判断整体任务完成（基于结构化状态 + Goal Assertion）

**主Agent约束**:
- 不直接调用任何工具/操作电脑
- 不携带 GUI 截图等大上下文
- 只做决策与调度

#### 3.4.2 TaskGraph 数据结构

完整定义见 [5. 数据模型定义](#5-数据模型定义)，此处给出示例:

```json
{
  "taskId": "t1",
  "goal": "整理桌面文件，按类型分类到对应文件夹",
  "goalAssertion": {
    "type": "all_of",
    "conditions": [
      {
        "type": "directory_not_empty",
        "path": "~/Desktop/Images",
        "description": "图片文件夹非空"
      },
      {
        "type": "directory_not_empty",
        "path": "~/Desktop/Documents",
        "description": "文档文件夹非空"
      },
      {
        "type": "file_count_equals",
        "path": "~/Desktop",
        "expected": 0,
        "description": "桌面根目录无文件"
      }
    ]
  },
  "steps": [
    {
      "id": "s1",
      "type": "file",
      "desc": "列出桌面所有文件",
      "dependsOn": [],
      "timeoutMs": 10000,
      "retryPolicy": {"maxAttempts": 2, "backoffMs": 1000}
    },
    {
      "id": "s2",
      "type": "file",
      "desc": "创建 Images 和 Documents 文件夹",
      "dependsOn": ["s1"],
      "timeoutMs": 5000
    },
    {
      "id": "s3",
      "type": "gui",
      "desc": "将图片文件移动到 Images 文件夹",
      "dependsOn": ["s2"],
      "timeoutMs": 60000,
      "guiActions": [...]   // 详见 GUI 部分
    }
  ],
  "limits": {
    "maxSteps": 10,
    "maxTokens": 10000,
    "timeoutSeconds": 300,
    "maxReplans": 3
  },
  "replanPolicy": {
    "enabled": true,
    "triggerConditions": ["step_failed", "file_not_found", "unexpected_popup", "goal_assertion_failed"],
    "scope": "partial"
  },
  "metadata": {
    "createdAt": "2026-03-29T10:00:00Z",
    "user": "alice"
  }
}
```

### 3.5 SubAgent 执行层

#### 3.5.1 SubAgent 类型与职责

| Agent类型 | 职责 | 使用的模型 | 可访问的状态 |
|-----------|------|------------|--------------|
| `FileAgent` | 文件读写、移动、删除、目录操作 | 轻量模型（如 GPT-4o-mini） | 只读任务状态，写状态需通过 State Store |
| `ShellAgent` | 执行命令行命令（受限白名单） | 轻量模型 | 只读任务状态 |
| `GuiAgent` | GUI自动化（点击、输入、拖拽等） | 轻量模型 | 读写状态（通过 State Store） |
| `BrowserAgent` | 浏览器自动化（导航、填表、截图） | 轻量模型 | 读写状态 |

#### 3.5.2 SubAgent 生命周期

```
1. 主Agent调用 SubAgentFactory.create(step)
2. 注入最小上下文（只包含当前 step 所需信息）
3. 执行 run() 方法
   - 可选读取 Global State Store
   - 执行具体操作（可能调用工具）
   - 更新 State Store（如果需要）
4. 返回 StepResult（成功/失败/需重试）
5. SubAgent 实例销毁，释放资源
```

**SubAgent 接口定义**:
```typescript
interface SubAgent {
  type: AgentType;
  execute(step: Step, context: SubAgentContext): Promise<StepResult>;
}

interface SubAgentContext {
  step: Step;                      // 当前步骤
  taskState: TaskState;            // 只读的任务级状态快照
  globalState: GlobalStateClient;  // 全局状态客户端（带版本控制）
  workspaceDir: string;            // 沙箱工作目录
  timeoutMs: number;               // 步骤超时
}
```

#### 3.5.3 并发控制

- **非GUI操作**（FileAgent, ShellAgent）：允许并发执行，受 `maxConcurrentSubAgents` 限制（默认8）
- **GUI操作**（GuiAgent, BrowserAgent）：全局串行队列，一次只执行一个，避免界面冲突

### 3.6 GUI 原子执行引擎

#### 3.6.1 设计目标

- 消除“无限截图-试探-重试”的低效循环
- 每个 GUI 操作为确定性指令，带前置条件与后置校验
- 支持跨平台（Windows UI Automation / macOS AXAPI / Linux AT-SPI）

#### 3.6.2 GUI 指令格式（LLM 生成的高层次表示）

为降低 LLM 生成 Token 消耗，采用 **模板化 + 默认值** 方式，LLM 只需输出简化版指令：

```json
{
  "action": "click_safe",
  "target": "button(\"确认\")",
  "overrides": {
    "waitStableMs": 500,
    "retryOnNotFound": false
  }
}
```

引擎内部展开为完整指令：

```json
{
  "action": "click",
  "target": "button(\"确认\")",
  "preconditions": [
    {"type": "window_exists", "name": "微信", "timeoutMs": 2000},
    {"type": "window_active", "name": "微信", "timeoutMs": 1000},
    {"type": "element_exists", "selector": "button(\"确认\")", "timeoutMs": 3000},
    {"type": "element_enabled", "selector": "button(\"确认\")", "timeoutMs": 1000},
    {"type": "element_visible", "selector": "button(\"确认\")", "timeoutMs": 1000}
  ],
  "postVerifies": [
    {"type": "text_exists", "text": "操作成功", "timeoutMs": 3000}
  ]
}
```

#### 3.6.3 支持的操作类型

| 操作 | 说明 | 默认前置条件 | 默认后置校验 |
|------|------|--------------|--------------|
| `click` | 点击元素 | 元素存在、可见、可点击 | 无 |
| `click_safe` | 点击并等待响应 | 同上 + 窗口激活 | 界面变化或文本出现 |
| `input` | 输入文本 | 输入框存在、可聚焦 | 无 |
| `input_safe` | 输入并确认 | 同上 | 输入内容已提交 |
| `drag` | 拖拽元素 | 源和目标元素存在、可见 | 无 |
| `wait` | 等待条件 | 无 | 条件满足 |
| `screenshot` | 截图 | 无 | 返回图片路径 |

#### 3.6.4 平台适配器接口

```typescript
interface PlatformAdapter {
  // 元素定位
  findElement(selector: ElementSelector): Promise<ElementHandle>;
  // 前置条件检查
  checkPrecondition(condition: Precondition): Promise<boolean>;
  // 执行操作
  performAction(action: GUIAction): Promise<void>;
  // 后置校验
  verifyPostCondition(condition: PostVerify): Promise<boolean>;
  // 等待界面稳定
  waitStable(ms: number): Promise<void>;
}
```

实现类:
- `WindowsUIAAdapter`（基于 UIAutomation）
- `MacOSAXAdapter`（基于 AXAPI）
- `LinuxAtSpiAdapter`（基于 AT-SPI）

### 3.7 全局状态中心（Global State Store）

#### 3.7.1 设计目标

- 解决 SubAgent 间状态同步问题，避免脏读/覆盖
- 提供原子性的读-改-写操作，带版本控制
- 支持事件订阅，减少轮询

#### 3.7.2 架构

```
┌─────────────────────────────────────────────────────────┐
│                  Global State Store                      │
│  ┌─────────────────────────────────────────────────┐   │
│  │  state: {                                        │   │
│  │    "desktop_files": { value: [...], version: 5 },│   │
│  │    "current_window": { value: "此电脑", v: 3 },  │   │
│  │    "move_progress": { value: {...}, version: 2 } │   │
│  │  }                                               │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  操作: get(key) → {value, version}                      │
│        set(key, value, expectedVersion) → bool         │
│        update(key, updater, mergeStrategy) → newVersion│
│                                                         │
│  事件总线: on(key, callback) → unsubscribe             │
└─────────────────────────────────────────────────────────┘
        ▲                ▲                ▲
        │                │                │
   ┌────┴────┐      ┌────┴────┐      ┌────┴────┐
   │FileAgent│      │GuiAgent │      │BrowserAgent│
   └─────────┘      └─────────┘      └───────────┘
```

#### 3.7.3 状态合并策略

每个状态键可配置 `mergeStrategy`:

| 策略 | 行为 | 适用场景 |
|------|------|----------|
| `overwrite` | 新值完全替换旧值 | 当前窗口、鼠标位置等单值状态 |
| `append` | 新值追加到数组末尾 | 日志、事件列表 |
| `union` | 数组合并去重 | 文件列表、已访问URL |
| `smart_merge` | 冲突时调用轻量LLM解决 | 复杂对象（极低频使用） |

**示例**:
```typescript
await stateStore.update(
  "desktop_files",
  (current) => [...current, "newfile.txt"],
  { mergeStrategy: "append", expectedVersion: currentVersion }
);
```

#### 3.7.4 作用域

| 作用域 | 生命周期 | 存储位置 | 用途 |
|--------|----------|----------|------|
| `task` | 单个TaskGraph执行周期 | 内存 | 任务内临时共享数据 |
| `session` | 整个会话（用户断开前） | Redis/本地文件 | 跨任务用户偏好 |
| `global` | 持久化 | SQLite/LevelDB | 长期记忆、统计数据 |

### 3.8 安全沙箱层

#### 3.8.1 隔离维度

| 维度 | 实现方式 |
|------|----------|
| 进程隔离 | 每个 SubAgent 在独立子进程中运行（Node.js `child_process.fork`） |
| 文件隔离 | 每个任务分配独立工作目录，路径白名单限制访问范围 |
| 网络隔离 | 基于 `security_policy.yaml` 配置允许的域名和端口 |
| 环境变量隔离 | SubAgent 继承最小环境变量集（PATH、TMPDIR 等） |
| 资源限制 | CPU 时间、内存、磁盘空间限制（Linux cgroups / Windows Job Objects） |

#### 3.8.2 沙箱实现方案

推荐使用 **FydeOS Linux 容器** 或 **Docker** 作为基础沙箱环境，OpenClaw 运行在容器内。

**Docker 配置示例**:
```dockerfile
FROM node:20-slim
RUN useradd -m -s /bin/bash openclaw
WORKDIR /home/openclaw/app
COPY . .
RUN npm ci
USER openclaw
CMD ["node", "dist/index.js"]
```

**运行参数**:
```bash
docker run \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=256m \
  --network none \   # 或使用自定义网络限制
  --memory 2g \
  --cpus 1 \
  -v /path/to/workspace:/home/openclaw/workspace:rw \
  openclaw:latest
```

### 3.9 基础设施层

#### 3.9.1 配置管理

使用 `cosmiconfig` 支持多种配置格式（JSON/YAML/TOML），配置优先级：

1. 环境变量 `OPENCLAW_*`
2. 配置文件 `.openclawrc.json` / `openclaw.config.yaml`
3. 默认配置

**默认配置示例**（见 [7. 配置参考](#7-配置参考)）

#### 3.9.2 结构化日志与遥测（OpenTelemetry）

所有关键操作记录结构化日志，支持导出到 Jaeger / Grafana。

**日志字段规范**:
```typescript
interface StructuredLog {
  timestamp: string;          // ISO 8601
  level: "debug"|"info"|"warn"|"error";
  sessionId: string;
  taskId?: string;
  stepId?: string;
  eventType: string;          // e.g., "taskgraph.created", "step.started", "state.updated"
  message: string;
  durationMs?: number;
  error?: {
    type: string;             // e.g., "FATAL", "RETRYABLE"
    code: string;
    message: string;
    stack?: string;
  };
  metadata?: Record<string, any>;
}
```

**OpenTelemetry Span 创建示例**:
```typescript
const tracer = opentelemetry.trace.getTracer('openclaw');
await tracer.startActiveSpan('execute_step', async (span) => {
  span.setAttribute('step.id', step.id);
  span.setAttribute('step.type', step.type);
  try {
    const result = await subAgent.execute(step);
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (err) {
    span.recordException(err);
    span.setStatus({ code: SpanStatusCode.ERROR });
    throw err;
  } finally {
    span.end();
  }
});
```

#### 3.9.3 记忆检索（ContextEngine）

基于 OpenClaw 3.8 开放的 ContextEngine 接口，集成 mem9 或自研实现。

**生命周期钩子**:
- `bootstrap`: Session 启动时加载长期记忆
- `ingest`: 每轮对话后提炼重要信息存入记忆
- `assemble`: 构建 prompt 时检索相关记忆
- `compact`: Token 紧张时压缩或转存历史

#### 3.9.4 事件总线

轻量级 EventEmitter，用于内部组件通信（非跨进程）。

**事件类型**:
- `task:created` / `task:completed` / `task:failed`
- `step:started` / `step:completed` / `step:failed`
- `state:updated` (key, oldValue, newValue)
- `replan:triggered` (reason, iteration)
- `security:violation` (details)

---

## 4. 核心机制详解

### 4.1 TaskGraph 可重规划（Partial Replan）

#### 4.1.1 触发条件

- 步骤执行失败（返回 `FATAL` 或连续 `RETRYABLE` 超过限制）
- 步骤结果与预期不符（如移动文件后目标文件不存在）
- 界面出现意外弹窗（GUI 步骤前置条件失败）
- Goal Assertion 校验失败（步骤全部完成但目标未达成）

#### 4.1.2 重规划流程

```
执行 Step N 失败
    │
    ▼
主Agent收集失败上下文：
  - 原 TaskGraph（剩余未执行步骤）
  - 失败步骤的完整输入/输出
  - 当前 Global State（关键键值）
  - 失败原因分类
    │
    ▼
主Agent调用 LLM 进行局部重规划
  Prompt 约束：
    - 只修改从失败步骤开始的后续步骤
    - 不得修改已成功步骤
    - 最多生成 5 个新步骤
    - 保持 Goal Assertion 不变（除非降级）
    │
    ▼
生成新的步骤列表（替换原 TaskGraph 中对应部分）
    │
    ▼
增加 replanCount，若 < maxReplans (默认3) 则继续执行
否则任务失败，通知用户
```

#### 4.1.3 Checkpoint 机制

每次成功步骤后自动保存检查点：

```json
{
  "checkpointId": "ck_123",
  "taskId": "t1",
  "completedStepIds": ["s1", "s2"],
  "completedStepsResults": [...],   // 完整结果，非摘要
  "globalStateSnapshot": {...},     // 关键状态键值快照
  "timestamp": "2026-03-29T10:05:00Z"
}
```

重规划时可选择回滚到最近检查点，避免上下文漂移。

#### 4.1.4 目标降级（当重规划仍失败）

第 2 次重规划后，如果 Goal Assertion 仍无法满足，主Agent可尝试**降级目标**：

- 原始断言: `file_count_equals(~/Desktop, 0)` → 降级为 `file_count_less_than(~/Desktop, 3)`
- 原始断言: `directory_not_empty(Images)` → 降级为 `directory_exists(Images)`

降级策略需预定义在 Goal Assertion 的 `fallback` 字段中。

### 4.2 GUI Precondition/PostVerify 轻量校验

#### 4.2.1 默认条件模板

引擎内置每种操作类型的默认前置/后置条件，LLM 只需覆盖例外。

**模板配置** (`gui_templates.yaml`):
```yaml
click_safe:
  default_preconditions:
    - type: window_exists
      timeoutMs: 2000
    - type: window_active
      timeoutMs: 1000
    - type: element_exists
      timeoutMs: 3000
    - type: element_enabled
      timeoutMs: 1000
    - type: element_visible
      timeoutMs: 1000
  default_postverifies:
    - type: interface_stable
      timeoutMs: 2000

input_safe:
  default_preconditions:
    - type: element_exists
      timeoutMs: 2000
    - type: element_focusable
      timeoutMs: 1000
  default_postverifies:
    - type: text_changed
      expectedContains: null   # 由LLM填充
```

#### 4.2.2 校验执行器

执行器按顺序检查条件，任一失败立即返回错误（不重试，由上层决定重试或重规划）。

**性能优化**:
- 相同元素的选择器结果缓存 500ms（避免重复查询）
- `wait_stable` 使用轻量级 DOM/界面变化检测，不依赖截图 OCR
- 对于 Accessibility API 无法获取的元素，降级使用 OCR（但会记录警告）

### 4.3 Goal Assertion 目标断言

#### 4.3.1 断言类型

| 类型 | 参数 | 说明 |
|------|------|------|
| `directory_not_empty` | `path` | 目录存在且至少有一个文件 |
| `file_count_equals` | `path, expected` | 目录下文件数量等于期望值 |
| `file_count_less_than` | `path, max` | 目录下文件数量小于阈值 |
| `total_files_match` | `original_path, target_paths` | 原位置文件总数等于目标位置文件总数（防止丢文件） |
| `regex_matches` | `path, pattern` | 文件内容或文件名匹配正则 |
| `no_errors_in_log` | `logPath` | 执行日志中无错误记录 |
| `custom` | `command` | 执行自定义脚本（Python/Shell），返回 0 表示成功 |

#### 4.3.2 断言执行

在 TaskGraph 所有步骤完成后执行（或重规划后再次执行）。

**伪代码**:
```python
def evaluate_assertion(assertion, context):
    if assertion.type == "all_of":
        return all(evaluate_assertion(c, context) for c in assertion.conditions)
    elif assertion.type == "any_of":
        return any(evaluate_assertion(c, context) for c in assertion.conditions)
    elif assertion.type == "directory_not_empty":
        return os.path.exists(assertion.path) and len(os.listdir(assertion.path)) > 0
    # ... 其他类型
    elif assertion.type == "custom":
        result = subprocess.run(assertion.command, shell=True, capture_output=True)
        return result.returncode == 0
```

### 4.4 错误三分类与熔断策略

#### 4.4.1 错误分类

```python
class ErrorType(Enum):
    RETRYABLE = "retryable"          # 瞬态错误，可重试
    NEED_USER_INPUT = "need_user"    # 需要用户介入
    FATAL = "fatal"                  # 不可恢复，直接终止
```

**分类规则表**:

| 错误码 | 描述 | 分类 | 重试策略 |
|--------|------|------|----------|
| `NETWORK_TIMEOUT` | 网络超时 | RETRYABLE | 指数退避，最多3次 |
| `ELEMENT_NOT_FOUND` | 界面元素未找到 | RETRYABLE（若界面可能延迟） / FATAL（若元素应存在） | 等待+重试，最多5次 |
| `FILE_NOT_FOUND` | 文件不存在 | FATAL | 不重试，触发重规划 |
| `PERMISSION_DENIED` | 权限不足 | NEED_USER_INPUT | 暂停任务，通知用户授权 |
| `PATH_NOT_ALLOWED` | 路径不在白名单 | FATAL | 直接终止 |
| `DISK_FULL` | 磁盘已满 | NEED_USER_INPUT | 通知用户清理空间 |

#### 4.4.2 熔断器

每个 SubAgent 类型独立熔断器，防止单点故障拖垮系统。

```python
class CircuitBreaker:
    def __init__(self, failure_threshold=5, timeout_seconds=60):
        self.failure_count = 0
        self.failure_threshold = failure_threshold
        self.timeout = timeout_seconds
        self.state = "CLOSED"  # CLOSED, OPEN, HALF_OPEN
        self.last_failure_time = 0

    def call(self, func):
        if self.state == "OPEN":
            if time.time() - self.last_failure_time > self.timeout:
                self.state = "HALF_OPEN"
            else:
                raise CircuitBreakerOpenError()

        try:
            result = func()
            if self.state == "HALF_OPEN":
                self.state = "CLOSED"
                self.failure_count = 0
            return result
        except Exception as e:
            self.failure_count += 1
            self.last_failure_time = time.time()
            if self.failure_count >= self.failure_threshold:
                self.state = "OPEN"
            raise e
```

### 4.5 结构化遥测与调试支持

#### 4.5.1 Dry-Run 模式

在正式执行前，生成 TaskGraph 后可在沙箱中模拟执行：

- 不操作真实 GUI/文件系统
- 记录每一步会产生的状态变更
- 验证 Goal Assertion 是否可能满足
- 输出模拟报告，预估成功率

**启用方式**: 配置 `dryRun: true` 或在请求中携带 `X-Dry-Run: true` header。

#### 4.5.2 可视化 Dashboard

基于 OpenTelemetry + Grafana 提供实时监控：

- **任务执行拓扑**: TaskGraph 步骤状态可视化
- **状态变更历史**: 时间线展示 Global State 的每次更新
- **错误分析面板**: 按错误类型、Agent 类型聚合
- **Token 消耗趋势**: 每次 LLM 调用的 Token 统计

#### 4.5.3 审计日志

所有安全相关事件（Security Arbiter 拒绝、危险技能二次确认、路径越权尝试）写入独立审计日志文件，不可篡改。

**审计日志格式** (JSON Lines):
```json
{"timestamp":"...","event":"security_denied","sessionId":"...","reason":"path_not_allowed","path":"/etc/passwd","rule":"blocked_paths"}
{"timestamp":"...","event":"user_approval","sessionId":"...","skill":"delete_all_files","approved":true}
```

---

## 5. 数据模型定义

### 5.1 TaskGraph

```typescript
interface TaskGraph {
  taskId: string;
  goal: string;
  goalAssertion: Assertion;
  steps: Step[];
  limits: TaskLimits;
  replanPolicy: ReplanPolicy;
  metadata: TaskMetadata;
  status: TaskStatus;          // pending | running | completed | failed | replanning
  currentStepIndex: number;
  replanCount: number;
  createdAt: string;
  updatedAt: string;
}

interface Step {
  id: string;
  type: "file" | "shell" | "gui" | "browser";
  desc: string;
  dependsOn: string[];         // step ids
  timeoutMs: number;
  retryPolicy?: RetryPolicy;
  // 根据 type 不同，携带不同的 action 定义
  action?: FileAction | ShellAction | GUIAction | BrowserAction;
}

interface TaskLimits {
  maxSteps: number;            // 默认 20
  maxTokens: number;           // 默认 20000
  timeoutSeconds: number;      // 默认 600
  maxReplans: number;          // 默认 3
}

interface ReplanPolicy {
  enabled: boolean;
  triggerConditions: string[];
  scope: "partial" | "full";
}
```

### 5.2 Assertion（目标断言）

```typescript
interface Assertion {
  type: "all_of" | "any_of" | "directory_not_empty" | "file_count_equals" | "file_count_less_than" | "total_files_match" | "regex_matches" | "no_errors_in_log" | "custom";
  conditions?: Assertion[];    // for all_of/any_of
  path?: string;               // for file/dir assertions
  expected?: number;           // for file_count_equals
  max?: number;                // for file_count_less_than
  originalPath?: string;       // for total_files_match
  targetPaths?: string[];      // for total_files_match
  pattern?: string;            // for regex_matches
  command?: string;            // for custom
  description: string;
  fallback?: Assertion;        // 降级断言（用于重规划后）
}
```

### 5.3 GUI Action

```typescript
interface GUIAction {
  action: "click" | "click_safe" | "input" | "input_safe" | "drag" | "wait" | "screenshot";
  target?: ElementSelector;
  value?: string;              // for input
  source?: ElementSelector;    // for drag
  destination?: ElementSelector;
  overrides?: {
    waitStableMs?: number;
    retryOnNotFound?: boolean;
    customPreconditions?: Precondition[];
    customPostVerifies?: PostVerify[];
  };
}

interface ElementSelector {
  type: "text" | "id" | "class" | "xpath" | "image";
  value: string;
  window?: string;             // 限定窗口标题
}
```

### 5.4 StepResult

```typescript
interface StepResult {
  stepId: string;
  status: "success" | "failed" | "retryable_failed";
  error?: {
    type: ErrorType;
    code: string;
    message: string;
    retryable: boolean;
  };
  output?: any;                // 步骤产出数据
  stateUpdates?: Record<string, any>;  // 建议的状态更新
  durationMs: number;
}
```

---

## 6. API 接口规范

### 6.1 内部 API（主Agent ↔ SubAgent）

SubAgent 通过标准接口暴露：

```typescript
// SubAgent 注册接口
interface SubAgentManifest {
  type: AgentType;
  supportedStepTypes: string[];
  execute(step: Step, context: SubAgentContext): Promise<StepResult>;
}

// 主Agent调用
const subAgent = agentRegistry.get(step.type);
const result = await subAgent.execute(step, {
  step,
  taskState: currentTaskState,
  globalState: stateStore.forTask(taskId),
  workspaceDir: `/tmp/openclaw/${sessionId}/${taskId}`,
  timeoutMs: step.timeoutMs
});
```

### 6.2 外部 API（WebSocket / HTTP）

**REST API**:

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/v1/tasks` | POST | 创建新任务（接受用户输入，返回 taskId） |
| `/api/v1/tasks/{taskId}` | GET | 查询任务状态和结果 |
| `/api/v1/tasks/{taskId}/cancel` | POST | 取消正在执行的任务 |
| `/api/v1/sessions/{sessionId}/state` | GET | 获取会话级全局状态 |
| `/api/v1/sessions/{sessionId}/approval` | POST | 提交危险操作的二次确认 |

**WebSocket 事件**:
- `task.started` / `task.completed` / `task.failed`
- `step.started` / `step.completed` / `step.failed`
- `approval.required` (需要用户确认)
- `log.line` (实时日志)

---

## 7. 配置参考

**默认配置文件** `.openclawrc.yaml`:

```yaml
# 模型配置
models:
  router:
    provider: ollama
    model: glm4:4b
    endpoint: http://localhost:11434
  planner:
    provider: openai
    model: gpt-4-turbo
    apiKey: ${OPENAI_API_KEY}
  executor:
    provider: anthropic
    model: claude-3-haiku-20240307
    apiKey: ${ANTHROPIC_API_KEY}

# 安全策略文件路径
security:
  policyFile: ./security_policy.yaml
  requireUserApprovalForDangerous: true

# 任务限制
taskDefaults:
  maxSteps: 20
  maxTokens: 20000
  timeoutSeconds: 600
  maxReplans: 3

# GUI 引擎
gui:
  platform: auto          # auto, win32, darwin, linux
  defaultWaitStableMs: 500
  useAccessibilityApi: true
  ocrFallback: false      # 仅当 accessibility 不可用时使用 OCR
  globalQueue: true

# 状态存储
stateStore:
  backend: redis          # memory, redis, sqlite
  redisUrl: redis://localhost:6379
  taskTtlSeconds: 3600
  sessionTtlSeconds: 86400

# 日志与遥测
observability:
  logLevel: info
  structuredLogs: true
  openTelemetry:
    enabled: false
    endpoint: http://localhost:4318/v1/traces
  dashboard:
    enabled: false
    port: 3000

# 沙箱
sandbox:
  type: docker           # none, docker, fydeos
  workspaceBase: /tmp/openclaw_workspaces
  networkIsolation: true
  memoryLimitMb: 2048
  cpuLimit: 1.0

# 性能调优
performance:
  maxConcurrentSubAgents: 8
  guiQueueSize: 20
  preconditionCacheTtlMs: 500
  checkpointIntervalSteps: 1
```

---

## 8. 执行流程示例

### 8.1 成功场景：整理桌面文件

**输入**: “整理桌面文件，按类型分类”

**步骤**:

1. **Viking路由**: 识别为 `file_ops` 意图，加载 `FileAgent` 工具，Token 从 15k 降至 3k。
2. **Security Arbiter**: 桌面路径在白名单内 ✓。
3. **主Agent生成TaskGraph**:
   - s1: 列出桌面文件
   - s2: 创建 Images/Documents 文件夹
   - s3: 移动图片到 Images
   - s4: 移动文档到 Documents
   - Goal Assertion: 桌面无文件，Images/Documents 非空，总数匹配
4. **执行**:
   - FileAgent 执行 s1，结果写入 State Store (`desktop_files`)
   - FileAgent 执行 s2，创建文件夹
   - GuiAgent 执行 s3（拖拽图片），Precondition 检查通过，执行，PostVerify 确认文件已移动
   - 重复 s4
5. **Goal Assertion**: 全部通过，任务成功。

### 8.2 异常场景：文件缺失触发 Partial Replan

**在 s3 执行时，某个图片文件被外部程序删除**。

- GuiAgent 返回 `FATAL` 错误 (`FILE_NOT_FOUND`)
- 主Agent 触发 Partial Replan：
  - 读取当前 State Store 中的 `desktop_files` 和已移动列表
  - 调用 LLM 生成新步骤 s3': 跳过缺失文件，移动其余文件
  - 继续执行
- 最终 Goal Assertion 中“总数匹配”失败，触发第二次重规划：
  - 降级断言为“桌面文件少于 3 个” + “Images 非空”
  - 用户收到通知：“文件 xxx 已丢失，已整理其余文件，是否满意？”
- 用户确认，任务结束。

---

## 9. 性能优化指南

### 9.1 Token 消耗优化

- **Viking 路由**：已实现 80%+ 节省。
- **SubAgent 上下文最小化**：每个 SubAgent 只接收当前 Step 描述 + 必要的 State 键值，不传完整历史。
- **截图按需**：GUI 步骤默认不截图，只有 PostVerify 失败时才触发视觉模型校验。
- **记忆摘要**：长会话使用 ContextEngine 压缩历史为摘要，而非原文传递。

### 9.2 执行延迟优化

- **Precondition 缓存**：相同元素选择器的检查结果缓存 500ms。
- **跳过非必要校验**：简单文件操作跳过 PostVerify。
- **并行执行**：无依赖关系的 FileAgent/ShellAgent 并发执行（受并发数限制）。
- **Dry-Run 提前验证**：复杂任务先 Dry-Run 发现大部分问题，减少线上失败重试。

### 9.3 资源限制

| 资源 | 限制 | 超限行为 |
|------|------|----------|
| 单任务最大 Token | 20k | 熔断终止 |
| 单任务最大步数 | 20 | 终止（可配置） |
| 单任务最大执行时间 | 10 分钟 | 终止 |
| 全局并发 SubAgent | 8 | 排队等待 |
| GUI 队列长度 | 20 | 拒绝新任务 |
| 单 SubAgent 内存 | 512 MB | 进程被杀死 |

---

## 10. 安全加固清单

基于 OpenClaw 3.22 安全加固及本架构新增：

| 类别 | 措施 |
|------|------|
| **路径遍历** | 所有文件路径规范化后检查是否在 allowed_paths 内；拦截 `../` 及 UNC 路径 |
| **命令注入** | Shell 命令使用白名单 + 参数转义；禁止直接拼接用户输入 |
| **环境变量注入** | 封锁危险变量（`MAVEN_OPTS`, `GLIBC_TUNABLES`, `LD_PRELOAD` 等） |
| **资源耗尽** | 限制单任务 Token、步数、时间；限制单次 API 响应大小 |
| **权限提升** | SubAgent 以低权限用户运行（非 root）；Docker 容器使用 `--cap-drop=ALL` |
| **敏感数据泄露** | 日志自动脱敏（API Key、密码、Token）；审计日志独立存储 |
| **供应链攻击** | 插件签名校验；依赖项定期扫描 |

---

## 11. 实施路线图

### Phase 1: 基础优化（2周）
- [ ] 集成 Viking 路由层（轻量模型意图识别）
- [ ] 实现 Security Arbiter 基本白名单
- [ ] 精简 AGENTS.md 文件
- [ ] 配置模型分层（路由/规划/执行）

### Phase 2: TaskGraph 核心（3周）
- [ ] 实现 TaskGraph 数据结构与存储
- [ ] 主Agent 一次性拆解能力（调用 LLM 生成 TaskGraph）
- [ ] 实现硬结束规则
- [ ] 实现 SubAgent 基础框架（FileAgent, ShellAgent）
- [ ] 实现全局状态中心（内存版）

### Phase 3: GUI 原子化（2周）
- [ ] 实现 GUI 引擎（平台适配器 Windows/macOS）
- [ ] 实现 Precondition/PostVerify 校验器
- [ ] 集成全局 GUI 队列
- [ ] 实现默认条件模板

### Phase 4: 重规划与容错（2周）
- [ ] 实现 Partial Replan 逻辑
- [ ] 实现错误三分类与熔断器
- [ ] 实现 Checkpoint 机制
- [ ] 实现 Goal Assertion 校验引擎

### Phase 5: 可观测性与安全（2周）
- [ ] 集成 OpenTelemetry 结构化日志
- [ ] 实现 Dry-Run 模式
- [ ] 实现审计日志
- [ ] 安全沙箱强化（Docker 部署）

### Phase 6: 集成与测试（1周）
- [ ] 端到端测试（覆盖异常场景）
- [ ] 性能基准测试
- [ ] 文档完善与发布

---

## 12. 附录：故障排查手册

### 12.1 常见问题

| 问题 | 可能原因 | 排查步骤 |
|------|----------|----------|
| 任务卡住不结束 | LLM 未返回终止信号或 Goal Assertion 未配置 | 检查 TaskGraph limits 是否合理；查看日志是否有 step 超时 |
| Token 消耗仍高 | Viking 路由未生效或 SubAgent 传递了过多上下文 | 检查路由日志；检查 SubAgent 是否误传了完整历史 |
| GUI 点击失败 | Precondition 未满足（元素不可见/被遮挡） | 开启 GUI 调试模式（记录界面树）；检查 PostVerify 超时设置 |
| Partial Replan 循环 | 重规划生成的新步骤仍然失败 | 检查重规划 Prompt 约束；增加 Checkpoint 回滚 |
| 状态冲突 | 多个 SubAgent 同时写同一键值 | 检查 mergeStrategy 配置；启用事件总线串行化 |

### 12.2 调试命令

```bash
# 开启 debug 日志
OPENCLAW_LOG_LEVEL=debug openclaw start

# Dry-Run 模式
openclaw run "整理桌面" --dry-run

# 导出 TaskGraph 为 JSON
openclaw task get <taskId> --format json

# 查看全局状态
openclaw state list --session <sessionId>

# 重放执行轨迹（需要 OpenTelemetry 后端）
openclaw replay <traceId>
```

### 12.3 性能基准参考

| 任务类型 | OpenClaw 原版 | 本架构（预期） |
|----------|--------------|----------------|
| 简单对话（“你好”） | 15k tokens, 3s | 1k tokens, 1.5s |
| 移动 10 个文件 | 45k tokens, 25s | 8k tokens, 8s |
| GUI 自动化（5 步） | 80k tokens, 60s | 15k tokens, 15s |
| 复杂任务（含重规划） | 不可预测 | 受 maxReplans 限制，可控 |

---

**文档结束**

> 本文档提供了 OpenClaw 下一代架构的完整技术设计，所有模块均有明确的接口定义、配置示例和实现路径。团队可据此分阶段实施，预期在 10 周内完成从原型到生产就绪的演进。