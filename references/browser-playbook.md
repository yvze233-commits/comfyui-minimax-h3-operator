# 浏览器子代理操作 ComfyUI 标准剧本

当 ComfyUI 位于认证网关后时，**所有页面交互、素材上传、工作流导入、点击 Run 与视频下载，一律通过 `browser` 子代理执行**。

---

## 1. 会话初始化与登录态复用
1. 首次调用 `invoke_subagent(TypeName="browser", Model="flash", Role="ComfyUI 端口执行员")` 打开目标 ComfyUI 地址 `<YOUR_COMFYUI_URL>`。
2. 若页面需要登录，**立刻暂停**并请用户在浏览器窗格完成登录；用户确认登录后，用 `send_message` 唤醒**同一个** `browser` 子代理（切勿 kill 或新开子代理，避免丢失已登录标签页）。
3. 整个制片周期内保持该 `browser` 子代理常驻复用（空闲不消耗 token）。

---

## 2. 安全暂存与标签页卫生规范（铁律）
1. **每次发给 `browser` 子代理前拷贝上传文件**：
   - 将待上传的图片、音频或 `.json` 工作流复制到 `<Artifact Directory>/browser_sandbox/uploads/<filename>`（单层文件名）。
   - `browser_sandbox/uploads/` 在子代理每轮退出时会自动清空，每次上传前必须重新拷贝。
2. **严禁改动或关闭用户原有的任何工作流标签页**：
   - 上传素材时：点击 `+` 新建临时空白工作流 → 使用 `LoadImage` 上传按钮上传 → 记录 `POST /api/upload/image`（HTTP 200）返回的精确服务端文件名 → **关闭该临时空白标签页**。
   - 导入并运行工作流时：点击 `+` 新建空白标签页 → `菜单 -> 文件 -> 打开` 导入 `<workflow>.json`。
3. **权限被拒绝时的处理**：
   - 若用户在浏览器弹窗中拒绝了 `browser_upload` 权限，**立刻停止**并向用户如实汇报，绝不循环重试或绕过。

---

## 3. 提交工作流的标准指令模板（发给 `browser` 子代理）

```text
请先检查 GET /api/queue 确认当前队列空闲，再将已放入 uploads 目录的 `<workflow>.json` 通过新建空白标签页（菜单 -> 文件 -> 打开）导入 ComfyUI：
1. 核验画布无红框、无缺模型弹窗、ResolutionSelector 与 SaveVideo 前缀（无斜杠）均正确加载；
2. 单次点击 Run 提交生成，确认 POST /api/prompt 返回 HTTP 200 及 `prompt_id`、`node_errors: {}`；
3. 查询 GET /api/queue 确认入队状态后立刻回报给我，不需要在页面等待渲染完成。
切勿关闭或改动用户原有任何工作流标签页。
```

---

## 4. 异步等待与收片下载标准指令模板

1. 收到 `prompt_id` 后，调用 `schedule(DurationSeconds=160, Prompt="...")` 定时唤醒（**严禁在 shell 里 sleep 轮询**）。
2. 定时器唤醒后，发消息给同一个 `browser` 子代理：

```text
请检查 ComfyUI 中任务（prompt_id: <PROMPT_ID>）的状态（GET /api/history/<PROMPT_ID> 与 GET /api/queue）：
- 若已完成（status_str == "success"），按节点 92 返回的精确 filename 与 subfolder，通过 `/api/view?filename=<filename>&subfolder=<subfolder>&type=output` 下载视频到本地 downloads 目录，并回报完整本地保存路径与文件大小；
- 若仍在运行或排队，请回报当前节点名、百分比进度与队列状态即可。
```

---

## 5. 强制亲自拉片自检（⛔ 严禁盲交！）
收到本地下载路径后，**必须立刻调用 `read_file` 亲自看视频、听语音**：
- [ ] **场景稳固度**：背景家具、书桌、道具是否纹丝不动、零漂移/瞬移？
- [ ] **镜头克制度**：机位是否稳固自然，无莫名其妙的反复放大缩小？
- [ ] **人物保真度**：同场角色是否全员入画、无缺人、无双胞胎重影、服装五官与三视图一致？
- [ ] **动态表现力**：角色肢体、表情与次级随动是否流畅自然、无静态僵死？
- [ ] **音画逐字验收**：台词是否 100% 字字清晰、无串麦、无抢跑、无吞尾静音、口型自然对齐？
