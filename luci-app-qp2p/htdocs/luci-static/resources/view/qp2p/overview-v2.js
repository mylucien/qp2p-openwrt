'use strict';
'require view';
'require poll';
'require uci';
'require ui';
'require dom';
'require qp2p.ctl-v2 as ctl';

/*
 * 概览页（设计稿 v2）：状态横幅 + 四格统计 + 成员列表 + 最近动态。
 * 按 joined / enabled 分三种状态：未入网（三步入网引导）、已停用、已入网。
 * 成员和动态都收在这一页，不再单开一页。
 */

var INSET = 'var(--section-inset,1.25rem)';

/* 卡片内容补内边距（Argon 主题的 .cbi-section 自己是 padding:0） */
function inset(children) {
	return E('div', { 'style': 'padding:0 ' + INSET + ' ' + INSET }, children);
}

function sectionTitle(text, right) {
	return E('h3', {
		'style': 'margin:0;padding:1em ' + INSET + ' .7em;font-size:15px;font-weight:600'
	}, [
		text,
		right ? E('span', {
			'style': 'float:right;font-size:12px;font-weight:400;opacity:.6'
		}, right) : ''
	]);
}

function peerBadge(state) {
	if (state === '在线')
		return [ '#1d9766', 'rgba(45,206,137,.12)', state ];
	if (/^离线/.test(state || ''))
		return [ '#8898aa', 'rgba(136,152,170,.12)', state ];
	if (/未知/.test(state || ''))
		return [ '#8898aa', 'rgba(136,152,170,.12)', state ];
	return [ '#fb6340', 'rgba(251,99,64,.12)', state || '未知' ];
}

function badge(text, fg, bg) {
	return E('span', {
		'style': 'display:inline-block;padding:2px 9px;border-radius:20px;font-size:12px;' +
			'background:' + bg + ';color:' + fg
	}, text);
}

function stat(label, valueNode, sub) {
	return E('td', { 'style': 'width:25%;vertical-align:top;padding:.8em .9em' }, [
		E('div', { 'style': 'font-size:12px;opacity:.6' }, label),
		E('div', { 'class': 'mono', 'style': 'font-size:19px;font-weight:600;margin-top:3px' }, valueNode),
		E('div', { 'style': 'font-size:12px;opacity:.5;margin-top:2px' }, sub || '')
	]);
}

function dot(color, glow) {
	return E('span', {
		'style': 'width:12px;height:12px;border-radius:50%;flex-shrink:0;background:' + color +
			';box-shadow:0 0 0 4px ' + glow
	});
}

/* 从 logread 里取最后一次出现的时间，用作「上次上线」 */
function lastSeen(text) {
	var m = String(text || '').match(/\b([01]\d|2[0-3]):[0-5]\d:[0-5]\d\b/g);
	return m && m.length ? m[m.length - 1].slice(0, 5) : '';
}

/* 动态按关键字上色，比一坨等宽文本好读 */
function logLines(text, limit) {
	var arr = String(text || '').split('\n').filter(function (l) { return l; });
	return arr.slice(-(limit || 6)).map(function (line) {
		var color = '';

		if (/失败|超时|连不上|错误|error/i.test(line))
			color = '#fb6340';
		else if (/已就绪|成功|已上线|直连已建立|✓/i.test(line))
			color = '#1d9766';

		return E('div', {
			'style': 'padding:2px 0;white-space:pre-wrap;word-break:break-all;' +
				'font-family:monospace;font-size:12.5px;line-height:1.5;color:' + (color || 'inherit')
		}, line);
	});
}

function renderLog(text, limit) {
	var lines = logLines(text, limit);
	return lines.length ? lines : E('div', { 'style': 'font-size:12px;opacity:.6' }, '（暂无日志）');
}

return view.extend({
	load: function () {
		return Promise.all([ ctl.refresh(), ctl.log(30) ]).then(function (res) {
			return {
				state: (res[0] && res[0].state) || {},
				error: (res[0] && res[0].error) || '',
				log: res[1] || ''
			};
		});
	},

	render: function (data) {
		this.state = (data && data.state) || {};
		this.log = (data && data.log) || '';
		this.nodes = {};
		this.tbody = null;

		var view;

		if (!this.state.joined)
			view = this.renderFresh();
		else if (!this.state.enabled)
			view = this.renderStopped();
		else
			view = this.renderJoined();

		/* 未入网时没有成员表可刷，只盯着 joined 有没有变成 1 */
		this.pollFn = this.refreshView.bind(this);
		poll.add(this.pollFn, 30);

		return view;
	},

	/* ---------------- 已入网 ---------------- */
	renderJoined: function () {
		var s = this.state;
		var running = s.running;
		var seen = lastSeen(this.log);

		this.nodes.state = E('strong', {}, running ? '运行中' : '已停止');
		this.nodes.net = E('span', { 'style': 'opacity:.7' },
			'网络 ' + (s.net || '?') + ' · ' + (s.cidr || '?'));
		this.nodes.ip = E('div', { 'class': 'mono' }, s.ip || '—');
		this.nodes.members = E('div', {}, '—');
		this.nodes.links = E('div', {}, '—');
		this.nodes.rtt = E('div', {}, '—');

		this.tbody = E('tbody', {});
		this.logBox = E('div', {
			'style': 'background:rgba(0,0,0,.035);border:1px solid rgba(0,0,0,.06);' +
				'border-radius:6px;padding:.7em .9em;max-height:14em;overflow:auto'
		}, renderLog(this.log, 6));

		var view = E('div', {}, [
			/* 状态横幅 */
			E('div', { 'class': 'cbi-section' }, [
				E('div', {
					'style': 'display:flex;align-items:center;gap:.9em;flex-wrap:wrap;' +
						'padding:1.1em ' + INSET
				}, [
					dot(running ? '#2dce89' : '#adb5bd',
						running ? 'rgba(45,206,137,.15)' : 'rgba(173,181,189,.15)'),
					E('span', { 'style': 'font-size:17px;font-weight:600' }, this.nodes.state),
					this.nodes.net,
					E('div', { 'style': 'flex:1' }),
					E('button', {
						'class': 'btn cbi-button',
						'click': ui.createHandlerFn(this, 'handleRestart')
					}, '重启服务'),
					E('button', {
						'class': 'btn cbi-button',
						'click': ui.createHandlerFn(this, 'handleShowToken')
					}, '显示令牌'),
					E('button', {
						'class': 'btn cbi-button cbi-button-reset',
						'click': ui.createHandlerFn(this, 'handleRotate')
					}, '换令牌')
				]),
				E('div', {
					'style': 'padding:0 ' + INSET + ' 1.1em;font-size:12px;opacity:.6'
				}, (seen ? '上次上线 ' + seen + ' · ' : '') +
					'程序 ' + (s.version || '?') + ' · 数据目录 /etc/qp2p · 虚拟网卡 ' +
					(s.dev || 'qp2p0') + '（MTU ' + (s.mtu || 1400) + '）')
			]),

			/* 四格统计 */
			E('div', { 'class': 'cbi-section' }, inset([
				E('table', { 'class': 'table' }, [
					E('tr', {}, [
						stat('本机虚拟地址', this.nodes.ip, '固定地址'),
						stat('在线成员', this.nodes.members, ''),
						stat('直连', this.nodes.links, ''),
						stat('平均延迟', this.nodes.rtt, '来自最近直连记录')
					])
				])
			])),

			/* 成员 */
			E('div', { 'class': 'cbi-section' }, [
				sectionTitle('成员', '每 30 秒自动刷新'),
				inset([ this.memberTable() ])
			]),

			/* 最近动态 */
			E('div', { 'class': 'cbi-section' }, [
				sectionTitle('最近动态', E('a', {
					'href': L.url('admin/vpn/qp2p/log')
				}, '查看全部日志 →')),
				inset([ this.logBox ])
			])
		]);

		this.fill(this.state.peers || []);
		return view;
	},

	/* ---------------- 已停用 ---------------- */
	renderStopped: function () {
		var s = this.state;

		this.tbody = E('tbody', {});

		var view = E('div', {}, [
			E('div', { 'class': 'cbi-section' }, [
				E('div', {
					'style': 'display:flex;align-items:center;gap:.9em;flex-wrap:wrap;' +
						'padding:1.1em ' + INSET
				}, [
					dot('#fb6340', 'rgba(251,99,64,.15)'),
					E('span', { 'style': 'font-size:17px;font-weight:600' }, '已停用'),
					E('span', { 'style': 'opacity:.7' },
						'网络 ' + (s.net || '?') + ' · 本机 ' + (s.ip || '—')),
					E('div', { 'style': 'flex:1' }),
					E('button', {
						'class': 'btn cbi-button cbi-button-apply',
						'click': ui.createHandlerFn(this, 'handleToggleEnabled')
					}, '启用并启动')
				]),
				E('div', {
					'style': 'padding:0 ' + INSET + ' 1.1em;font-size:12px;opacity:.6'
				}, '配置和身份都还在，启用后会自动重连。')
			]),
			E('div', { 'class': 'cbi-section' }, [
				sectionTitle('成员', '服务未运行，数据为上次上线时的快照'),
				inset([ this.memberTable() ])
			])
		]);

		this.fill(this.state.peers || []);
		return view;
	},

	/* ---------------- 首次使用 ---------------- */
	renderFresh: function () {
		var s = this.state;

		this.freshWorker = E('input', {
			'class': 'cbi-input-text', 'type': 'text',
			'placeholder': 'https://p2p.example.com', 'style': 'width:100%'
		});
		this.freshToken = E('input', {
			'class': 'cbi-input-text', 'type': 'text',
			'placeholder': 'qp2p1_home_xxxxxxxx', 'style': 'width:100%'
		});

		function field(label, hint, input) {
			return E('div', {
				'style': 'display:grid;grid-template-columns:minmax(9em,170px) 1fr;gap:1em;' +
					'align-items:center;padding:.9em 0;border-bottom:1px solid rgba(0,0,0,.07)'
			}, [
				E('div', {}, [
					E('div', { 'style': 'font-size:13.5px' }, label),
					E('div', { 'style': 'font-size:12px;opacity:.6;margin-top:.3em' }, hint)
				]),
				input
			]);
		}

		function step(n, text) {
			return E('div', {
				'style': 'flex:1;min-width:14em;display:flex;gap:.7em;align-items:flex-start;' +
					'background:rgba(0,0,0,.035);border-radius:8px;padding:.8em'
			}, [
				E('span', {
					'style': 'width:24px;height:24px;border-radius:50%;background:#5e72e4;color:#fff;' +
						'display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:13px'
				}, String(n)),
				E('span', { 'style': 'font-size:13px;line-height:1.5' }, text)
			]);
		}

		return E('div', {}, [
			E('div', { 'class': 'cbi-section' }, [
				E('div', {
					'style': 'display:flex;align-items:center;gap:.9em;flex-wrap:wrap;' +
						'padding:1.1em ' + INSET
				}, [
					dot('#adb5bd', 'rgba(173,181,189,.15)'),
					E('span', { 'style': 'font-size:17px;font-weight:600' }, '还没有加入网络'),
					E('div', { 'style': 'flex:1' }),
					E('span', { 'style': 'opacity:.6;font-size:13px' }, '程序 ' + (s.version || '?'))
				]),
				E('div', {
					'style': 'padding:0 ' + INSET + ' 1.1em;font-size:13px;opacity:.65'
				}, 'qp2p 通过信令服务器撮合，让没有公网 IP 的设备打洞直连，业务流量不经过服务器。')
			]),
			E('div', { 'class': 'cbi-section' }, [
				sectionTitle('三步入网'),
				inset([
					E('div', {
						'style': 'display:flex;gap:.8em;flex-wrap:wrap;margin-bottom:1em'
					}, [
						step(1, '填信令服务器地址（部署服务的人会给）'),
						step(2, '粘贴加入令牌（管理员发的 qp2p1_…）'),
						step(3, '点「加入网络」，成功后自动上线')
					]),
					field('信令服务器', '例如 https://p2p.example.com', this.freshWorker),
					field('加入令牌', '只用于这次入网，不会写进 /etc/config', this.freshToken),
					E('div', { 'style': 'padding:1.1em 0 .2em;display:flex;align-items:center;gap:1em;flex-wrap:wrap' }, [
						E('button', {
							'class': 'btn cbi-button cbi-button-apply',
							'click': ui.createHandlerFn(this, 'handleJoinFresh')
						}, '加入网络'),
						E('span', { 'style': 'font-size:12px;opacity:.6' },
							'本机名称、固定地址等可稍后在「设置」里补')
					])
				])
			])
		]);
	},

	/* ---------------- 成员表 ---------------- */
	memberTable: function () {
		return E('table', { 'class': 'table' }, [
			E('thead', {}, [
				E('tr', { 'class': 'tr table-titles' }, [
					E('th', { 'class': 'th' }, '名称'),
					E('th', { 'class': 'th' }, '虚拟地址'),
					E('th', { 'class': 'th' }, '状态'),
					E('th', { 'class': 'th' }, '延迟'),
					E('th', { 'class': 'th', 'style': 'width:6em' }, '操作')
				])
			]),
			this.tbody
		]);
	},

	fill: function (peers) {
		if (!this.tbody)
			return;

		var rows = [];
		var linked = 0;
		var rttSum = 0;
		var selfIp = this.state.ip;
		var self = this;

		peers.forEach(function (p) {
			if (p.rtt != null) {
				linked++;
				rttSum += parseFloat(p.rtt) || 0;
			}

			var c = peerBadge(p.state);
			var isSelf = selfIp && p.ip === selfIp;

			rows.push(E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, [
					p.name || '—',
					isSelf ? E('span', {
						'style': 'margin-left:.5em;display:inline-block;padding:2px 9px;' +
							'border-radius:20px;font-size:12px;background:rgba(94,114,228,.1);color:#5e72e4'
					}, '本机') : ''
				]),
				E('td', { 'class': 'td mono' }, p.ip || '—'),
				E('td', { 'class': 'td' }, badge(c[2], c[0], c[1])),
				E('td', { 'class': 'td mono' }, p.rtt != null ? (p.rtt + ' ms') : '—'),
				E('td', { 'class': 'td' }, [
					E('button', {
						'class': 'btn cbi-button',
						'click': function () {
							ui.addNotification(null, E('p', {},
								'在 SSH 里执行：ping ' + (p.ip || '对端虚拟地址')), 'info');
						}
					}, 'ping')
				])
			]));
		});

		if (!rows.length) {
			rows.push(E('tr', { 'class': 'tr placeholder' }, [
				E('td', { 'class': 'td', 'colspan': 5, 'style': 'opacity:.6' },
					'还没有其它成员。把令牌发给别的设备，它们 join 之后就会出现在这里。')
			]));
		}

		dom.content(this.tbody, rows);

		if (this.nodes.members) {
			var online = peers.filter(function (p) { return p.state === '在线'; }).length;
			this.nodes.members.textContent = online + ' 台';
			this.nodes.links.textContent = linked + ' 台';
			this.nodes.rtt.textContent = linked ? Math.round(rttSum / linked) + ' ms' : '—';
		}
	},

	/* ---------------- 轮询 ---------------- */
	refreshView: function () {
		var self = this;

		return ctl.refresh().then(function (res) {
			var st = (res && res.state) || {};
			if (st.joined === undefined)
				return;

			/* 入网 / 停用状态变了，整个页面结构都不一样，直接重载 */
			if (st.joined !== self.state.joined || st.enabled !== self.state.enabled) {
				location.reload();
				return;
			}

			self.state = st;

			if (self.nodes.state)
				self.nodes.state.textContent = st.running ? '运行中' : '已停止';
			if (self.nodes.net)
				self.nodes.net.textContent = '网络 ' + (st.net || '?') + ' · ' + (st.cidr || '?');
			if (self.nodes.ip)
				self.nodes.ip.textContent = st.ip || '—';

			self.fill(st.peers || []);

			if (!self.logBox)
				return;

			return ctl.log(30).then(function (log) {
				self.log = log || '';
				dom.content(self.logBox, renderLog(self.log, 6));
			});
		});
	},

	/* ---------------- 动作 ---------------- */
	handleRestart: function () {
		return ctl.exec('restart').then(function (res) {
			return ctl.showResult('重启服务', res);
		});
	},

	handleToggleEnabled: function () {
		var next = this.state.enabled ? '0' : '1';

		return uci.load('qp2p').then(function () {
			uci.set('qp2p', 'main', 'enabled', next);
			return uci.save();
		}).then(function () {
			return uci.apply();
		}).then(function () {
			return ctl.exec('restart');
		}).then(function (res) {
			return ctl.showResult(next == '1' ? '启用' : '停止', res);
		}).then(function () {
			location.reload();
		});
	},

	handleShowToken: function () {
		return ctl.confirm('显示完整令牌',
			'令牌等同于入网密码，注意别被旁人看到。', '显示').then(function (ok) {
			if (!ok)
				return;

			return ctl.exec('token').then(function (res) {
				return ctl.showResult('加入令牌', res);
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

	/* 首次入网：读两个输入框 → 一次交给 CLI */
	handleJoinFresh: function () {
		var token = String(this.freshToken.value || '').replace(/^\s+|\s+$/g, '');
		var worker = String(this.freshWorker.value || '').replace(/^\s+|\s+$/g, '');

		if (!worker || !token) {
			ui.addNotification(null, E('p', {},
				!worker ? '先填信令服务器地址' : '先粘贴加入令牌'), 'error');
			return;
		}

		return ctl.exec('join', [ token, worker ]).then(function (res) {
			return ctl.showResult(res.code == 0 ? '加入成功' : '加入失败', res);
		}).then(function (res) {
			if (!res || res.code != 0)
				return;

			return ctl.exec('restart').then(function () { location.reload(); });
		});
	},

	destroy: function () {
		if (this.pollFn) {
			poll.remove(this.pollFn);
			this.pollFn = null;
		}
	}
});
