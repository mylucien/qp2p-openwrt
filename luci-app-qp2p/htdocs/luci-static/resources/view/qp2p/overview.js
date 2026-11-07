'use strict';
'require view';
'require poll';
'require uci';
'require ui';
'require qp2p.ctl as ctl';

/* 一个「标题 + 等宽数值 + 小字说明」的单元格，四个拼成一行 */
function stat(label, valueNode, sub) {
	return E('td', { 'style': 'width:25%;vertical-align:top;padding:.6em .8em' }, [
		E('div', { 'style': 'opacity:.6;font-size:90%' }, label),
		valueNode,
		E('div', { 'style': 'opacity:.5;font-size:90%' }, sub || '')
	]);
}

function mono(text) {
	return E('div', { 'style': 'font-size:130%;font-family:monospace' }, text);
}

function kv(k, v) {
	return [
		E('td', { 'class': 'th', 'style': 'width:32%' }, k),
		E('td', { 'style': 'font-family:monospace;word-break:break-all' }, v)
	];
}

return view.extend({
	load: function () {
		return ctl.refresh().then(function (res) {
			return res.state || {};
		});
	},

	render: function (state) {
		var self = this;

		this.state = state || {};
		this.nodes = {};

		if (this.state.running === undefined) {
			return E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, 'qp2p 组网'),
				E('p', { 'class': 'alert-message warning' },
					'读不到 qp2p 的状态。确认 qp2p 包已经装好（/usr/bin/qp2p 是否存在）。'),
				E('button', {
					'class': 'btn cbi-button',
					'click': function () { location.reload(); }
				}, '重新加载')
			]);
		}

		var s = this.state;

		var led = E('span', {
			'style': 'display:inline-block;width:.7em;height:.7em;border-radius:50%;' +
				'margin-right:.5em;background:' + (s.running ? '#2e7d32' : '#9e9e9e')
		});
		this.nodes.status = E('strong', {}, s.running ? '运行中' : (s.enabled ? '已停止' : '未启用'));
		this.nodes.net = E('span', { 'class': 'label', 'style': 'opacity:.7' }, s.joined
			? ('网络 ' + (s.net || '?') + ' · ' + (s.cidr || '?'))
			: '还没有加入任何网络');

		this.nodes.ip = mono(s.ip || '—');
		this.nodes.links = mono('—');
		this.nodes.linksub = E('div', { 'style': 'opacity:.5;font-size:90%' }, '');

		var tokenBox = E('input', {
			'class': 'cbi-input-text',
			'type': 'text',
			'readonly': 'readonly',
			'value': s.token_hint || '（还没加入网络）',
			'style': 'width:100%;font-family:monospace'
		});

		var view = E('div', {}, [
			/* 状态条 */
			E('div', { 'class': 'cbi-section', 'style': 'padding:.4em 0' }, [
				E('div', { 'style': 'display:flex;align-items:center;gap:1em;flex-wrap:wrap' }, [
					E('span', { 'style': 'display:flex;align-items:center' }, [ led, this.nodes.status ]),
					this.nodes.net,
					E('div', { 'style': 'flex:1' }),
					E('button', {
						'class': 'btn cbi-button',
						'click': ui.createHandlerFn(this, 'handleRestart')
					}, '重启服务'),
					E('button', {
						'class': 'btn cbi-button cbi-button-reset',
						'click': ui.createHandlerFn(this, 'handleToggleEnabled')
					}, s.enabled ? '停止并关闭自启' : '启用并启动')
				])
			]),

			/* 四个数字 */
			E('div', { 'class': 'cbi-section' }, [
				E('table', { 'class': 'table' }, [
					E('tr', {}, [
						stat('本机虚拟地址', this.nodes.ip, s.cidr ? ('网段 ' + s.cidr) : ''),
						stat('直连', this.nodes.links, ''),
						stat('虚拟网卡', mono((s.dev || 'qp2p0') + ' · MTU ' + (s.mtu || 1400)),
							'地址与路由由 qp2p 下发'),
						stat('程序版本', mono(s.version || '—'),
							s.worker ? '信令已配置' : '还没填信令地址')
					])
				])
			]),

			/* 令牌 */
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, '加入令牌'),
				E('div', { 'class': 'cbi-value' }, [
					E('div', { 'class': 'cbi-value-field' }, [
						E('div', { 'style': 'display:flex;gap:.5em;flex-wrap:wrap' }, [
							E('div', { 'style': 'flex:1;min-width:16em' }, tokenBox),
							E('button', {
								'class': 'btn cbi-button',
								'click': ui.createHandlerFn(this, 'handleShowToken')
							}, '显示完整令牌'),
							E('button', {
								'class': 'btn cbi-button cbi-button-reset',
								'click': ui.createHandlerFn(this, 'handleRotate')
							}, '换新令牌')
						]),
						E('div', { 'class': 'cbi-value-description' },
							'其它设备执行 qp2p join <令牌> 就能入网。换令牌后旧令牌立刻失效，' +
							'已经入网的设备要重新 join 一次。')
					])
				])
			]),

			/* 本机信息 */
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, '本机信息'),
				E('table', { 'class': 'table' }, [
					E('tr', { 'class': 'tr' }, kv('信令服务器', s.worker || '未设置')),
					E('tr', { 'class': 'tr' }, kv('网络', s.net ? (s.net + '  ' + (s.cidr || '')) : '未加入')),
					E('tr', { 'class': 'tr' }, kv('UDP 监听', (s.bind || '0.0.0.0') + ':' + (s.port || 51820))),
					E('tr', { 'class': 'tr' }, kv('数据目录', '/etc/qp2p')),
					E('tr', { 'class': 'tr' }, kv('STUN', s.stun || '默认')),
					E('tr', { 'class': 'tr' }, kv('额外路由', s.routes || '无'))
				])
			])
		]);

		this.pollFn = function () { return self.refreshView(); };
		poll.add(this.pollFn, 5);

		return view;
	},

	refreshView: function () {
		var self = this;

		return ctl.state().then(function (st) {
			if (!st || st.running === undefined)
				return;

			self.state = st;

			if (self.nodes.status)
				self.nodes.status.textContent = st.running ? '运行中' : (st.enabled ? '已停止' : '未启用');
			if (self.nodes.net)
				self.nodes.net.textContent = st.joined
					? ('网络 ' + (st.net || '?') + ' · ' + (st.cidr || '?'))
					: '还没有加入任何网络';
			if (self.nodes.ip)
				self.nodes.ip.textContent = st.ip || '—';

			var peers = st.peers || [];
			var linked = peers.filter(function (p) { return p.rtt != null; });

			if (self.nodes.links)
				self.nodes.links.textContent = linked.length + ' / ' + peers.length;
			if (self.nodes.linksub)
				self.nodes.linksub.textContent = peers.length
					? (linked.length + ' 台已直连，其余在重试')
					: '还没有其它成员';
		});
	},

	handleRestart: function () {
		return ctl.exec('restart').then(function (res) {
			ctl.show('重启服务', res);
		});
	},

	handleToggleEnabled: function () {
		var self = this;
		var next = this.state.enabled ? '0' : '1';

		return uci.load('qp2p').then(function () {
			uci.set('qp2p', 'main', 'enabled', next);
			return uci.save();
		}).then(function () {
			return uci.apply();
		}).then(function () {
			return ctl.exec('restart');
		}).then(function (res) {
			ctl.show(next == '1' ? '启用' : '停止', res);
			return self.refreshView();
		});
	},

	handleShowToken: function () {
		return ctl.confirm('显示完整令牌',
			'令牌等同于入网密码，注意别被旁人看到。', '显示').then(function (ok) {
			if (!ok)
				return;

			return ctl.exec('token').then(function (res) {
				ctl.show('加入令牌', res);
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
				ctl.show('换新令牌', res);
			});
		});
	},

	destroy: function () {
		if (this.pollFn) {
			poll.remove(this.pollFn);
			this.pollFn = null;
		}
	}
});
