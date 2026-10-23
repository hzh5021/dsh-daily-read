/**
 * dsh-daily-read — 客户端那一半：侧边栏一个条目，页面里一个大按钮。
 *
 * 按钮怎么干活（2026-10-23 重写）：
 *   原来那版是"替你在输入框里敲一次 /daily"，两处都站不住：
 *     一、布局的 `main` 是 keyed 槽 —— `MainPanel` 里写着
 *         `renderSlot("main", {}, { entryKey: activePanelId ?? "conversation" })`。
 *         点开这个面板就等于把对话视图整个卸下来，输入框根本不在 DOM 里，
 *         所以按钮永远摸不到它（图上那句"没找到输入框"就是这么来的）。
 *     二、就算还在，DSH 的输入框是 Lexical 富文本（`contenteditable`，
 *         带 `data-composer-chip`），`textContent` + 一个 input 事件塞不进去。
 *   换成内核自己的口子：`ctx.remote.commands.execute(sessionId, "/daily")` ——
 *   命令面板里敲回车走的正是这条路，纯 RPC，不碰 DOM。
 *
 * 面板是"命中就走"的：命令送出去就 `layout.selectPanel(null)` 回对话界面 ——
 * 结果（command/run、command/done、我读完那段话）都在对话里。
 *
 * 会话从哪儿来：面板打开时主区已经换成自己了，"当前会话"取不到实时值，
 * 所以订阅 `ctx.sessions.list`，把最近一次被主区保留的会话记在 lastSessionId 里。
 *
 * 模块形状照 @linxin666/dsh-client-ui-skill-explorer（本机已验证能加载的那种）：
 *   window.__ModuleLoader__.load({ id, factory }) ，factory 里 exports.apply / inject。
 *
 * @module dsh-daily-read/client
 */

window.__ModuleLoader__.load({
	id: "dsh-daily-read",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;

		const React = require("react");
		const h = React.createElement;

		/** 面板 id：侧边栏那一行和主区那一页共用一个。 */
		const PANEL_ID = "daily-read";
		/** 交给宿主执行的命令行（host 侧 index.js 注册的）。 */
		const COMMAND = "/daily";

		/** apply 时拿到的根 ctx：面板组件在 render 之外也要用它发命令。 */
		let rootCtx;
		/** 最近一次被主区保留的会话，面板打开时靠它兜底。 */
		let lastSessionId;

		/** 谁被对话那列保留着，谁就是当前会话。 */
		function retainedSessionIds(ctx) {
			try {
				const byId = ctx.sessions.list.getSnapshot().byId;
				return Object.values(byId)
					.filter((session) => (session.retainedBy?.mainView ?? 0) > 0)
					.map((session) => session.id);
			} catch (error) {
				return [];
			}
		}

		/** 认当前会话；认不出就沿用上一次认得的那个。 */
		function currentSessionId(ctx) {
			const retained = retainedSessionIds(ctx);
			if (retained.length === 1) lastSessionId = retained[0];
			else if (retained.length > 1 && !retained.includes(lastSessionId)) lastSessionId = retained[0];
			return lastSessionId;
		}

		/** 坐着订阅会话列表，随时把"当前是哪个"记下来。 */
		function trackCurrentSession(ctx) {
			currentSessionId(ctx);
			ctx.effect(() => {
				const stop = ctx.sessions.list.subscribe(() => currentSessionId(ctx));
				return () => stop();
			}, "daily-read: track current session");
		}

		/** 回对话界面；没有 layout 就作罢。 */
		function backToConversation(ctx) {
			try {
				ctx.layout?.selectPanel?.(null);
			} catch (error) {
				console.warn("[daily-read] selectPanel failed:", error);
			}
		}

		/** 侧边栏那一行的小图标。 */
		function DailyIcon() {
			return h("svg", {
				width: 18,
				height: 18,
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 1.8,
				strokeLinecap: "round",
				strokeLinejoin: "round",
			},
				h("path", { d: "M4 5.5A1.5 1.5 0 0 1 5.5 4H16l4 4v11.5A1.5 1.5 0 0 1 18.5 21h-13A1.5 1.5 0 0 1 4 19.5Z" }),
				h("path", { d: "M15 4v4h5" }),
				h("path", { d: "M8 13h8M8 17h5" }));
		}

		/** 主区那一页：一个按钮，一句话说明。 */
		function DailyPanel() {
			const [note, setNote] = React.useState("");

			const go = async () => {
				const ctx = rootCtx;
				if (!ctx) {
					setNote("插件还没接上 ctx —— 刷新一下页面再来。");
					return;
				}
				const execute = ctx.remote?.commands?.execute;
				if (typeof execute !== "function") {
					setNote(`这个内核没暴露命令接口 —— 回对话里手动敲 ${COMMAND} 吧。`);
					backToConversation(ctx);
					return;
				}
				const sessionId = currentSessionId(ctx);
				if (sessionId === undefined) {
					setNote("没认出当前是哪个会话 —— 左边点开一个会话，再回来按。");
					return;
				}
				let result;
				try {
					result = await execute.call(ctx.remote.commands, sessionId, COMMAND, []);
				} catch (error) {
					setNote(`没送出去：${(error && error.message) || error}`);
					return;
				}
				if (!result || result.ok !== true) {
					const code = (result && result.error && result.error.code) || "?";
					const message = (result && result.error && result.error.message) || "";
					setNote(`宿主拒了：${code} ${message}`);
					return;
				}
				if (result.value === undefined) {
					setNote(`宿主不认 ${COMMAND} 这条命令。`);
					return;
				}
				const outcome = result.value.result;
				if (outcome && outcome.kind === "error") {
					setNote(outcome.text || "命令报错了。");
					return;
				}
				setNote((outcome && outcome.text) || "去了。");
				backToConversation(ctx);
			};

			return h("div", {
				style: {
					padding: "32px",
					display: "flex",
					flexDirection: "column",
					alignItems: "flex-start",
					gap: "16px",
				},
			},
				h("h2", { style: { margin: 0, fontSize: "18px", fontWeight: 600 } }, "刷B站日报"),
				h("p", { style: { margin: 0, opacity: 0.72, fontSize: "13px", lineHeight: 1.8, maxWidth: "46em" } },
					"点一下，我就去读最新那篇日报，读完跟你说我自己的理解——不复述报告里的结论。"),
				h("button", {
					type: "button",
					onClick: go,
					style: {
						padding: "10px 20px",
						borderRadius: "8px",
						border: "1px solid rgba(127,127,127,.45)",
						background: "rgba(127,127,127,.14)",
						color: "inherit",
						cursor: "pointer",
						fontSize: "14px",
						fontFamily: "inherit",
					},
				}, "读最新日报"),
				note ? h("div", { style: { fontSize: "12px", opacity: 0.65 } }, note) : null);
		}

		/** 注册侧边栏条目与主区页面。 */
		function register(ctx) {
			const slots = ctx.slots;
			const disposers = [];
			try {
				disposers.push(slots.inject("sidebar.panellist", () => slots.register({
					name: "sidebar.panellist",
					id: PANEL_ID,
					order: 30,
					label: () => "读日报",
				}, DailyIcon)));
				disposers.push(slots.inject("main", () => slots.register({
					name: "main",
					key: PANEL_ID,
				}, DailyPanel)));
			} catch (error) {
				console.warn("[daily-read] panel registration failed:", error);
			}
			return () => {
				for (const dispose of disposers.splice(0)) dispose();
			};
		}

		function apply(ctx) {
			rootCtx = ctx;
			try {
				trackCurrentSession(ctx);
			} catch (error) {
				console.warn("[daily-read] session tracking failed:", error);
			}
			const dispose = register(ctx);
			ctx.effect(() => dispose, "daily-read: ui mounts");
		}

		exports.apply = apply;
		// 2026-10-23 修：客户端 inject 要写"服务短名"（客户端 ctx 里注册的名字），
		// 不是包全名。写包全名 → e.get() 永远 undefined → 纤维 pending 到死 →
		// web boot 报 `1 entry did not activate`，桌面端随即把整个 profile 重置。
		// 包全名是 package.json 里 dsh.client.inject 的写法，两处不是一回事。
		// 这一版用到的四个面：slots（挂 UI）、sessions（认当前会话）、
		// remote + remote.commands（把 /daily 交给宿主执行）、layout（办完回对话界面）。
		// 对照（本机已验证能加载的）：commands → ["inputTriggers","sessions","remote",
		// "remote.commands","locale"]；plugin-manager → ["slots","locale","remote",
		// "remote.pluginManager",...,"layout"]。
		exports.inject = ["slots", "sessions", "remote", "remote.commands", "layout"];
		return module.exports;
	},
});