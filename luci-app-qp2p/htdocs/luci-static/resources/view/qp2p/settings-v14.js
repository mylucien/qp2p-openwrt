'use strict';
'require view';
'require uci';
'require ui';
'require qp2p.ctl-v2 as ctl';

/*
 * 设置页（设计稿 v2）：基础 / 高级设置（折叠）两块；换令牌和注销并进
 * 基础卡片底部的按钮行，四个按钮排一行，不再单开「危险操作」框。
 *
 * 不再用 form.Map：那套基类在 Argon 主题下会静默跳过保存
 * （DOM.callClassMethod 找不到实例返回 null，Promise.all([null]) 照样成功），
 * 之前反复出现「填了信令服务器却报先填信令服务器」就是这么来的。
 * 这里直接读输入框，链路短且可验证。
 *
 * 保存语义与原生 LuCI 完全一致：
 *  - 输入时只改表单，不动 UCI；
 *  - 点「保存」→ uci.set + uci.save，只进 /tmp/.uci 暂存（不落盘、不重启），
 *    顶部出现「未保存的配置」；
 *  - 点「保存并应用」→ uci.set + uci.save + ui.changes.apply()，走原生
 *    HTTP 接口 admin/uci/apply_rollback：commit 并触发 procd 的
 *    config.change（qp2p.init 已注册 reload trigger，reload 就是 stop+start），
 *    成功后 LuCI 自己刷新页面。
 *    没有真实改动时服务端返回 204，LuCI 提示「没有需要应用的更改」，
 *    不会再抛 ubus code 5（No data received）。
 *
 * 不再自己调 uci.apply() / ctl restart：前者无改动时会抛 code 5，
 * 后者会让同一次保存重启两遍。
 *
 * 页面底部的「保存并应用 / 保存」由 LuCI 的 View.addFooter() 自动生成，
 * 条件是 view 实现了 handleSave / handleSaveApply。页面里不再自己画按钮，
 * 否则就是和系统重复的两组。
 */

var INSET = 'var(--section-inset,1.25rem)';
/* 按钮行用 grid 均分，四个按钮等宽；窄屏自动折成两列，不挤成一团 */
var BTN_CELL = { 'style': 'white-space:nowrap' };
var RE_IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
var RE_CIDR = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/;
var RE_STUN = /^[A-Za-z0-9.\-]+:\d{2,5}$/;
var RE_DEV = /^[A-Za-z0-9_.-]{1,15}$/;

function inset(children) {
	return E('div', { 'style': 'padding:0 ' + INSET + ' ' + INSET }, children);
}

function card(title, children) {
	return E('div', { 'class': 'cbi-section' }, [
		E('h3', {
			'style': 'margin:0;padding:1em ' + INSET + ' .7em;font-size:15px;font-weight:600'
		}, title),
		inset(children)
	]);
}

function field(label, hint, control) {
	return E('div', {
		'style': 'display:grid;grid-template-columns:minmax(9em,170px) 1fr;gap:1em;' +
			'align-items:center;padding:.85em 0;border-bottom:1px solid rgba(0,0,0,.07)'
	}, [
		E('div', {}, [
			E('div', { 'style': 'font-size:13.5px' }, label),
			E('div', { 'style': 'font-size:12px;opacity:.6;margin-top:.3em;line-height:1.5' }, hint)
		]),
		control
	]);
}

function button(text, style, click, attrs) {
	var a = {
		'class': 'btn cbi-button ' + (style || ''),
		'click': click
	};

	if (attrs) {
		Object.keys(attrs).forEach(function (k) { a[k] = attrs[k]; });
	}

	return E('button', a, text);
}

function isIpv4(value) {
	var m = RE_IPV4.exec(value);
	if (!m)
		return false;

	for (var i = 1; i <= 4; i++)
		if (parseInt(m[i], 10) > 255)
			return false;

	return true;
}

function splitList(value) {
	return String(value || '').split(/[\s,]+/).filter(function (v) { return v !== ''; });
}

function checkList(value, test, hint) {
	var bad = splitList(value).filter(function (v) { return !test(v); });
	return bad.length ? hint + '：' + bad.join('、') : null;
}

return view.extend({
	load: function () {
		return Promise.all([ uci.load('qp2p'), ctl.state() ]).then(function (res) {
			return res[1] || {};
		});
	},

	render: function (state) {
		var s = state || {};
		var self = this;

		this.inputs = {};

		/* 输入过程中只改表单，不动 UCI —— 与原生 LuCI 一致。
		   真正的 uci.set / uci.save 在点「保存」或「保存并应用」时
		   由 saveValues() 统一做，避免改动一多就反复写暂存区。 */

		/* 每个控件都登记进 inputs，保存时兜底再收集一次 */
		function text(key, placeholder, value) {
			var el = E('input', {
				'class': 'cbi-input-text',
				'type': 'text',
				'placeholder': placeholder || '',
				'style': 'width:100%'
			});
			el.value = value == null ? '' : String(value);
			self.inputs[key] = el;
			return el;
		}

		function flag(key, on) {
			var el = E('input', { 'type': 'checkbox' });
			/* 直接写属性，别用 E 的 checked:'' —— 空字符串也会被当成「已勾选」 */
			el.checked = !!on;
			self.inputs[key] = el;
			return el;
		}

		function choice(key, options, value) {
			var el = E('select', {
				'class': 'cbi-input-select',
				'style': 'width:100%'
			}, options.map(function (o) {
				return E('option', { 'value': o[0] }, o[1]);
			}));
			el.value = value || options[0][0];
			self.inputs[key] = el;
			return el;
		}

		var basic = card('基础', [
			field('启用', '关掉后服务不启动，开机也不会自动拉起。',
				flag('enabled', s.enabled == 1)),
			field('信令服务器', '只做撮合，业务流量不经过它。可以只填域名，会自动补 https://。',
				text('worker', 'https://p2p.example.com', s.worker)),
			field('加入令牌', '以 qp2p1_ 开头；只用于这次入网，不写进 /etc/config。',
				text('_token', 'qp2p1_home_xxxxxxxx', '')),
			E('div', {
				'style': 'display:grid;grid-template-columns:repeat(auto-fit,minmax(7.5em,1fr));' +
					'gap:.7em;padding:1em 0 .2em;max-width:38em'
			}, [
				button('加入网络', 'cbi-button-apply',
					ui.createHandlerFn(this, 'handleJoin'), BTN_CELL),
				button('创建网络…', '', ui.createHandlerFn(this, 'handleCreate'), BTN_CELL),
				button('换新令牌', '', ui.createHandlerFn(this, 'handleRotate'), BTN_CELL),
				button('注销', 'cbi-button-reset', ui.createHandlerFn(this, 'handleLeave'), BTN_CELL)
			]),
			E('div', { 'style': 'font-size:12px;opacity:.6;padding-bottom:.3em;line-height:1.6' },
				'四个框一次填完再点入网；本机名称和固定地址在「高级设置」里。' +
				'换新令牌会让旧令牌立刻失效；注销只下线，身份和令牌保留。')
		]);

		var listen = E('div', { 'style': 'display:flex;gap:.6em' }, [
			E('div', { 'style': 'flex:2' }, text('bind', '0.0.0.0', s.bind || '0.0.0.0')),
			E('div', { 'style': 'flex:1' }, text('port', '51820', s.port || '51820'))
		]);

		var advanced = E('div', { 'class': 'cbi-section' }, [
			inset([
				E('details', {}, [
					E('summary', {
						'style': 'list-style:none;cursor:pointer;padding:.9em 0;color:#5e72e4;' +
							'font-size:13.5px;display:flex;align-items:center;gap:.5em;user-select:none'
					}, [
						E('span', { 'style': 'display:inline-block;transition:transform .15s' }, '▸'),
						'高级设置（本机名称、固定地址、监听、MTU、STUN、路由、防火墙）'
					]),
					E('div', { 'style': 'padding-bottom:.6em' }, [
						field('本机名称', '成员列表里显示的名字，留空用主机名。',
							text('name', '留空用主机名', s.name)),
						field('固定虚拟地址', '填了会被服务端预留，重启不变；留空由服务端分配。',
							text('ip', '留空自动分配', s.ip)),
						field('UDP 监听', '打洞用，一般不用改。左边地址，右边端口。', listen),
						field('虚拟网卡名', '默认 qp2p0，Linux 网卡名最长 15 字节。',
							text('dev', 'qp2p0', s.dev || 'qp2p0')),
						field('MTU', '默认 1400。链路差（4G）可降到 1280。',
							text('mtu', '1400', s.mtu || '1400')),
						field('空闲断开', '直连空闲这么多秒就断开，0 表示从不断开。',
							text('idle', '0', s.idle || '0')),
						field('STUN 服务器', '空格或逗号分隔，多个并行探测。',
							text('stun', 'stun.cloudflare.com:3478', s.stun)),
						field('信令传输方式', 'ws 由服务端推送，省请求；poll 轮询；auto 自动（0.1.7+）。',
							choice('transport', [
								[ 'auto', 'auto（默认，先试推送再退回轮询）' ],
								[ 'ws', 'ws（WebSocket 推送）' ],
								[ 'poll', 'poll（轮询）' ]
							], s.transport || 'auto')),
						field('忙轮询', '收包忙等的微秒数，0 = 关闭；50-100 能降一点延迟，' +
							'但更吃 CPU，只在 Linux 生效（0.1.16+）。',
							text('busy_poll', '0', s.busy_poll || '0')),
						field('额外路由', '这些网段送进隧道，用来访问对端身后局域网。空格或逗号分隔。',
							text('routes', '192.168.1.0/24 192.168.2.0/24', s.routes)),
						field('局域网互通', '放通 LAN → qp2p 并 masquerade；对端访问本机 LAN 需对端也通告网段。',
							E('div', {}, [
								E('label', {
									'style': 'display:flex;align-items:center;gap:.5em;font-size:13.5px'
								}, [ flag('lan_access', s.lan_access != 0), '允许局域网访问 qp2p' ]),
								E('label', {
									'style': 'display:flex;align-items:center;gap:.5em;font-size:13.5px;margin-top:.6em'
								}, [ flag('peer_to_lan', s.peer_to_lan == 1), '允许对端访问局域网' ])
							])),
						field('局域网 zone', '一般就是 lan；改过防火墙 zone 名字的按实际填。',
							text('lan_zone', 'lan', s.lan_zone || 'lan'))
					])
				])
			])
		]);

		/* 折叠箭头：原生 details 没有可样式化的 ::before，这里手动转一下 */
		var summary = advanced.querySelector('summary');
		var arrow = summary ? summary.firstChild : null;
		if (summary) {
			advanced.querySelector('details').addEventListener('toggle', function (ev) {
				if (arrow)
					arrow.style.transform = ev.target.open ? 'rotate(90deg)' : '';
			});
		}

		/* 保存按钮交给 LuCI 的 View.addFooter()：只要 view 实现了
		   handleSave / handleSaveApply，页面底部就会自动出现
		   「保存并应用 / 保存」，这里不再画第二组。 */

		return E('div', {}, [
			basic,
			advanced
		]);
	},

	/* ---------------- 读写 ---------------- */
	values: function () {
		var v = {};

		Object.keys(this.inputs || {}).forEach(function (k) {
			var el = this.inputs[k];
			v[k] = (el.type === 'checkbox')
				? (el.checked ? '1' : '0')
				: String(el.value || '').replace(/^\s+|\s+$/g, '');
		}, this);

		return v;
	},

	validate: function (v) {
		var err;

		if (v.worker && !/^(https?:\/\/)?[A-Za-z0-9._\-]+(:\d{1,5})?(\/[^\s]*)?$/.test(v.worker))
			return '信令服务器：填域名或 IP，例如 p2p.example.com';
		if (v.name && v.name.length > 32)
			return '本机名称：最多 32 个字符';
		if (v.ip && !isIpv4(v.ip))
			return '固定虚拟地址：不是合法 IPv4';
		if (v.bind && !isIpv4(v.bind))
			return 'UDP 监听地址：不是合法 IPv4';
		if (!(parseInt(v.port, 10) >= 1 && parseInt(v.port, 10) <= 65535))
			return 'UDP 端口：要落在 1-65535';
		if (v.dev && !RE_DEV.test(v.dev))
			return '虚拟网卡名：只能用字母、数字、下划线和短横线（≤15 字符）';
		if (!(parseInt(v.mtu, 10) >= 576 && parseInt(v.mtu, 10) <= 1500))
			return 'MTU：要在 576-1500 之间';
		if (v.idle && !/^\d+$/.test(v.idle))
			return '空闲断开：要填秒数（0 或正整数）';
		if (v.stun) {
			err = checkList(v.stun, function (x) { return RE_STUN.test(x); },
				'STUN 服务器：格式应为 host:port，这几项不对');
			if (err)
				return err;
		}
		if (v.routes) {
			err = checkList(v.routes, function (x) { return RE_CIDR.test(x); },
				'额外路由：要写成 192.168.1.0/24，这几项不对');
			if (err)
				return err;
		}
		if ([ 'auto', 'ws', 'poll' ].indexOf(v.transport) < 0)
			return '信令传输方式：只能是 auto / ws / poll';
		if (!/^\d+$/.test(v.busy_poll) || parseInt(v.busy_poll, 10) > 1000)
			return '忙轮询：要填 0-1000 之间的整数微秒（0 = 关闭）';

		return null;
	},

	/* 只写 UCI，不重启。入网 / 建网前也走这里，保证 CLI 读得到最新值。
	   uci.load 在页面 load() 阶段已经做过，uci.save() 内部也会 unload+load，
	   这里不再重复加载。 */
	saveValues: function () {
		var v = this.values();
		var err = this.validate(v);

		if (err) {
			ui.addNotification(null, E('p', {}, err), 'error');
			return Promise.reject(new Error(err));
		}

		Object.keys(v).forEach(function (k) {
			if (k.charAt(0) === '_')
				return;
			uci.set('qp2p', 'main', k, v[k]);
		});

		return uci.save().catch(function (e) {
			ui.addNotification(null, E('p', {},
				'写入配置失败：' + (e && e.message || e)), 'error');
			return Promise.reject(e);
		});
	},

	/* 原生「保存」：只把改动推进 /tmp/.uci 暂存区，不落盘、不重启。
	   顶部随后出现「未保存的配置」，用户可以稍后再点「保存并应用」。 */
	handleSave: function () {
		return this.saveValues().then(function () {
			return Promise.resolve(ui.changes && ui.changes.init ? ui.changes.init() : null);
		}).catch(function () {
			/* 校验 / 写入失败已经用通知提示过，这里只避免未捕获的 rejection */
		});
	},

	/* 原生「保存并应用」：走 ui.changes.apply()，即 POST
	   admin/uci/apply_rollback（commit + procd reload），由 LuCI 负责
	   进度提示、成功后刷新页面；没有真实改动时服务端回 204，LuCI 自己
	   提示「没有需要应用的更改」，不会再抛 ubus code 5。 */
	handleSaveApply: function (ev, mode) {
		return this.saveValues().then(function () {
			ui.changes.apply(mode == '0');
		}).catch(function () {
			/* 同上 */
		});
	},

	/* ---------------- 入网 / 建网 ---------------- */
	handleJoin: function () {
		var v = this.values();

		if (!v.worker) {
			ui.addNotification(null, E('p', {}, '先填信令服务器地址'), 'error');
			return;
		}
		if (!v._token) {
			ui.addNotification(null, E('p', {}, '先在上面「加入令牌」里填令牌'), 'error');
			return;
		}

		return this.saveValues().then(function () {
			return ctl.exec('join', [ v._token, v.worker, v.name, v.ip ]);
		}).then(function (res) {
			return ctl.showResult(res.code == 0 ? '加入成功' : '加入失败', res);
		}).then(function (res) {
			if (!res || res.code != 0)
				return;

			return ctl.exec('restart').then(function () { location.reload(); });
		});
	},

	handleCreate: function () {
		var netName = null;

		return this.saveValues().then(function () {
			return ctl.prompt('创建网络',
				'网络名只能用小写字母、数字和连字符，例如 home。', 'home');
		}).then(function (name) {
			netName = name;
			if (!name)
				return null;

			return ctl.prompt('创建网络', '填部署信令服务时设的 ADMIN_SECRET。',
				'ADMIN_SECRET', 'password');
		}).then(function (secret) {
			if (!netName || !secret)
				return null;

			return ctl.exec('create', [ netName, secret ]);
		}).then(function (res) {
			if (!res)
				return;

			return ctl.showResult(res.code == 0 ? '创建成功' : '创建失败', res)
				.then(function (r) {
					if (r.code != 0)
						return;
					return ctl.exec('restart').then(function () { location.reload(); });
				});
		});
	},

	handleRotate: function () {
		return ctl.prompt('换新令牌',
			'需要 ADMIN_SECRET。新令牌由服务端随机生成，生成后只显示这一次。',
			'ADMIN_SECRET', 'password').then(function (secret) {
			if (secret === null)
				return;

			return ctl.exec('rotate', [ secret ]).then(function (res) {
				return ctl.showResult('换新令牌', res);
			});
		});
	},

	handleLeave: function () {
		return ctl.confirm('从网络注销',
			'本机会从成员列表里消失，但令牌和身份保留，随时可以再上线。', '注销')
			.then(function (ok) {
				if (!ok)
					return;

				return ctl.exec('leave').then(function (res) {
					return ctl.showResult('注销', res);
				});
			});
	}
});
