/**
 * dsh-daily-read — 让「去读最新那篇刷B站日报」变成一次点击。
 *
 * 机制（照抄本机 dsh-research-commands 验证过的路子，DSH 0.2.1-rc.2）：
 *   - 斜杠命令只能由代码注册（`ctx.commands.register()`），丢文件丢不出来；
 *   - handler 里用 `agent.steer({role:"user",...})` 把一条 user message 注入当前会话，
 *     模型收到就会去干活 —— 这正是内置 `/plan` 驱动模型的方式。
 *   - 不 import 任何 `@deepseek-ai/*`：那些是宿主提供的 peer，版本对不上会拉进第二份内核。
 *     只用 Node 内建模块。
 *
 * 为什么是"注入一句话"而不是"把日报正文塞进去"：
 *   正文塞进去，我就只会念报告；只给路径，我会去读原文，然后自己说想到了什么。
 *
 * @module dsh-daily-read
 */

import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** Plugin identity for the loader roster. */
export const name = "daily-read";

/** The command registry is the only host service this plugin needs. */
export const inject = ["commands"];

/** 刷B站插件的日报目录（它自己的家目录）。 */
const OUT_DIR = join(homedir(), ".dsh", "bili-duty", "out");

/** 和 harness 自己 createUserMessage 的输出同形；本地构造，避免宿主 import。 */
function userMessage(text) {
  return {
    role: "user",
    content: [{ type: "text", text }],
    source: { kind: "user" },
  };
}

/** 在 out\YYYY-MM-DD.md 里挑日期最新的一篇。 */
async function newestReport() {
  let names;
  try {
    names = await readdir(OUT_DIR);
  } catch {
    return null;
  }
  const days = names.filter((n) => /^\d{4}-\d{2}-\d{2}\.md$/.test(n)).sort();
  if (days.length === 0) return null;
  return { file: join(OUT_DIR, days[days.length - 1]), name: days[days.length - 1] };
}

/** 注册命令。 */
export function apply(ctx) {
  ctx.effect(function* () {
    yield ctx.commands.register({
      name: "daily",
      description: "读最新那篇刷B站日报（读完说自己的理解，不复述）",
      handler: async ({ agent }) => {
        const found = await newestReport();
        if (found === null) {
          return { kind: "error", text: `还没找到日报：${OUT_DIR} 里没有 YYYY-MM-DD.md` };
        }
        const steer = agent?.steer;
        if (typeof steer !== "function") {
          return { kind: "error", text: "这个 harness 没有暴露 agent.steer，/daily 起不来。" };
        }
        steer.call(agent, userMessage([
          `去读最新那篇刷B站日报：${found.file}`,
          "",
          "读原文（别只看我这句话），然后跟我说你自己的理解——不要复述报告里的结论，说你看完之后想到了什么。",
        ].join("\n")));
        return { kind: "success", text: `去读 ${found.name}。` };
      },
    });
  }, "daily-read lifecycle");
}