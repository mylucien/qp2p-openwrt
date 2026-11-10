'use strict';
'require form';
'require view';
'require uci';
'require ui';
'require qp2p.ctl as ctl';

var RE_IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
var RE_CIDR = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/;
var RE_STUN = /^[A-Za-z0-9.\-]+:\d{2,5}$/;
var RE_DEV = /^[A-Za-z0-9_.-]{1,15}$/;

function splitList(value) {
	return String(value || '').split(/[\s,]+/).filter(function (v) { return v !== ''; });
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

/* 列表型字段通用校验：逐个检查，返回第一条错误 */
function checkList(value, test, hint) {
	var bad = splitList(value).filter(function (v) { return !test(v); });
	return bad.length ? hint + '：' + bad.join('、') : true;
}

return view.extend({
	load: function () {
		return Promise.all([ uci.load('qp2p'), ctl.state() ]).then(function (res) {
			return res[1] || {};
		});
	},

	render: function (state) {
		var m, s, o;

		state = state || {};

		m = new form.Map('qp2p', 'qp2p 组网',
			'设置保存在 /etc/config/qp2p。点「保存并应用」会提交配置并重启服务；' +
			'服务启动时会把这些设置写进 /etc/qp2p/config.toml。');

		s = m.section(form.NamedSection, 'main', 'qp2p');
		s.anonymous = true;
		s.addremove = false;

		/* ---------------- 开关 ---------------- */
		o = s.option(form.Flag, 'enabled', '启用',
			'关掉后服务不启动，开机也不会自动拉起。');
		o.default = '0';
		o.rmempty = false;

		/* ---------------- 信令 ---------------- */
		o = s.option(form.Value, 'worker', '信令服务器',
			'Cloudflare Worker 的地址，例如 <code>https://p2p.example.com</code>。' +
			'它只做撮合，业务流量不经过它。');
		o.placeholder = 'https://p2p.example.com';
		o.validate = function (section_id, value) {
			if (!value)
				return true;
			/* 允许只填域名/IP，保存后由 qp2p-ctl 补 https:// */
			return /^(https?:\/\/)?[A-Za-z0-9._\-]+(:\d{1,5})?(\/[^\s]*)?$/.test(value)
				? true : '填域名或 IP，例如 p2p.example.com';
		};

		o = s.option(form.Value, 'name', '本机名称',
			'成员列表里显示的名字。留空用主机名。');
		o.placeholder = '留空用主机名';
		o.validate = function (section_id, value) {
			return (!value || value.length <= 32) ? true : '最多 32 个字符';
		};

		o = s.option(form.Value, 'ip', '固定虚拟地址',
			'填了会被服务端预留，重启不变；留空由服务端分配。' +
			'必须落在本网络网段内，冲突会直接报错。');
		o.placeholder = '留空自动分配';
		o.validate = function (section_id, value) {
			if (!value)
				return true;
			return isIpv4(value) ? true : '不是合法 IPv4';
		};

		/*
		 * 令牌只在这次入网时用，不进 UCI：覆盖 write 让它永远不落 /etc/config。
		 * 值在点「加入网络」时用 formvalue() 直接读输入框。
		 */
		o = s.option(form.Value, '_token', '加入令牌',
			'以 <code>qp2p1_</code> 开头，粘贴带令牌的链接也能识别。' +
			'只用于这次入网，不会写进 /etc/config/qp2p。');
		o.placeholder = 'qp2p1_home_xxxxxxxx';
		o.rmempty = true;
		o.write = function () {};
		this.tokenOpt = o;

		/* ---------------- 入网动作 ---------------- */
		o = s.option(form.Button, '_join', '入网',
			'把上面的信令地址、本机名称、固定地址和令牌一起提交：先存盘，' +
			'再向信令服务登记一次，结果会弹出来。');
		o.inputtitle = '加入网络';
		o.inputstyle = 'action';
		o.onclick = ui.createHandlerFn(this, 'handleJoin');

		o = s.option(form.Button, '_create', '建网',
			'只有部署信令服务的人（拿着 ADMIN_SECRET）才需要建网，建完把新令牌发给其它设备。');
		o.inputtitle = '创建网络…';
		o.inputstyle = 'action';
		o.onclick = ui.createHandlerFn(this, 'handleCreate');

		o = s.option(form.Button, '_rotate', '换令牌',
			'旧令牌立刻失效。已经在跑的节点直连不会马上断，但它们下次刷新注册会被拒，' +
			'需要拿新令牌重新入网。');
		o.inputtitle = '换新令牌…';
		o.inputstyle = 'reset';
		o.onclick = ui.createHandlerFn(this, 'handleRotate');

		o = s.option(form.Button, '_leave', '注销',
			'把本机从网络里注销，但本机保存的令牌和身份都还在，随时可以再上线。');
		o.inputtitle = '从网络注销';
		o.inputstyle = 'reset';
		o.onclick = ui.createHandlerFn(this, 'handleLeave');

		/* ---------------- 隧道参数 ---------------- */
		o = s.option(form.Value, 'bind', 'UDP 监听地址',
			'打洞用，默认 <code>0.0.0.0</code>，一般不用改。');
		o.placeholder = '0.0.0.0';
		o.default = '0.0.0.0';
		o.validate = function (section_id, value) {
			if (!value)
				return true;
			return isIpv4(value) ? true : '不是合法 IPv4';
		};

		o = s.option(form.Value, 'port', 'UDP 端口',
			'同一台机器只能有一个实例占用这个端口，默认 51820。');
		o.default = '51820';
		o.validate = function (section_id, value) {
			var n = parseInt(value, 10);
			return (n >= 1 && n <= 65535) ? true : '端口要落在 1-65535';
		};

		o = s.option(form.Value, 'dev', '虚拟网卡名',
			'默认 <code>qp2p0</code>。Linux 网卡名最长 15 字节。');
		o.placeholder = 'qp2p0';
		o.default = 'qp2p0';
		o.validate = function (section_id, value) {
			return (!value || RE_DEV.test(value)) ? true : '只能用字母、数字、下划线和短横线（≤15 字符）';
		};

		o = s.option(form.Value, 'mtu', 'MTU',
			'默认 1400。链路质量差（比如 4G）可以降到 1280。');
		o.default = '1400';
		o.validate = function (section_id, value) {
			var n = parseInt(value, 10);
			return (n >= 576 && n <= 1500) ? true : 'MTU 要在 576-1500 之间';
		};

		o = s.option(form.Value, 'idle', '空闲断开',
			'直连空闲这么多秒就断开，有流量时自动重连。0 表示从不断开。');
		o.default = '0';
		o.validate = function (section_id, value) {
			return (!value || /^\d+$/.test(value)) ? true : '要填秒数（0 或正整数）';
		};

		o = s.option(form.Value, 'stun', 'STUN 服务器',
			'空格或逗号分隔，可以写多个并行探测。' +
			'判定 NAT 类型至少需要两台不同 IP 的服务器有回应。');
		o.placeholder = 'stun.cloudflare.com:3478 stun.miwifi.com:3478';
		o.validate = function (section_id, value) {
			return (!value || checkList(value, function (v) { return RE_STUN.test(v); },
				'格式应为 host:port，这几项不对'));
		};

		o = s.option(form.Value, 'routes', '额外路由',
			'这些网段会被送进隧道，用来访问对端背后的局域网。空格或逗号分隔。');
		o.placeholder = '192.168.1.0/24 192.168.2.0/24';
		o.validate = function (section_id, value) {
			return (!value || checkList(value, function (v) { return RE_CIDR.test(v); },
				'不是合法网段（要写成 192.168.1.0/24），这几项不对'));
		};

		/* ---------------- 局域网互通 ---------------- */
		o = s.option(form.Flag, 'lan_access', '允许局域网访问 qp2p',
			'给 <code>qp2p0</code> 建一个防火墙 zone，放通 LAN → qp2p 的转发，' +
			'并把源地址 masquerade 成路由器自己的虚拟地址（否则对端不知道往哪回包）。');
		o.default = '1';
		o.rmempty = false;

		o = s.option(form.Flag, 'peer_to_lan', '允许对端访问局域网',
			'放通 qp2p → LAN 的转发，并给隧道网段到非隧道网段的流量做 SNAT。' +
			'对端要在它那边把本机局域网网段填进「额外路由」才用得上。');
		o.default = '0';
		o.rmempty = false;

		o = s.option(form.Value, 'lan_zone', '局域网 zone',
			'一般就是 <code>lan</code>；改过防火墙 zone 名字的按实际填。');
		o.placeholder = 'lan';
		o.default = 'lan';

		/* 记住 Map 实例：保存时直接调它的 save()，不走基类那套 DOM 查找 */
		this.map = m;

		return m.render();
	},

	/*
	 * 保存表单。直接调 form.Map.save()，不用基类的 handleSave：
	 * 基类实现是扫 #maincontent 下的 .cbi-map 再 DOM.callClassMethod(map, 'save')，
	 * 而 callClassMethod 找不到实例时只 return null —— Promise.all([null]) 照样
	 * 成功，保存就这么被静默跳过了，表单里填的东西一个都没进 UCI。
	 *
	 * Map.save() 失败时自己会弹 save error 对话框，比这里再包一层清楚。
	 */
	saveForm: function (ev) {
		if (ev && typeof ev.preventDefault === 'function')
			ev.preventDefault();

		if (!this.map || typeof this.map.save !== 'function')
			return Promise.reject(new Error('表单还没就绪，刷新页面再试'));

		return this.map.save();
	},

	/* 只保存：Map.save() 只写 UCI 文件，不重启服务 */
	handleSave: function (ev) {
		return this.saveForm(ev).then(function () {
			ui.addNotification(null, E('p', {},
				'已保存。服务要重启后才会读到新设置。'), 'info');
		});
	},

	/* 保存并应用：写 UCI → commit → 重启服务（启动时才生成 config.toml） */
	handleSaveApply: function (ev, mode) {
		return this.saveForm(ev).then(function () {
			return uci.apply();
		}).then(function () {
			return ctl.exec('restart');
		}).then(function (res) {
			ctl.show('已保存并应用', res);
		});
	},

	/*
	 * 入网：表单里的信令地址 / 本机名称 / 固定地址一起保存，令牌从输入框直接读。
	 * 令牌不进 UCI，也不经过弹窗 —— 填完点一次就完事。
	 */
	handleJoin: function () {
		var token = String((this.tokenOpt && this.tokenOpt.formvalue('main')) || '')
			.replace(/^\s+|\s+$/g, '');

		if (!token) {
			ui.addNotification(null, E('p', {}, '先在上面「加入令牌」里填令牌'), 'error');
			return;
		}

		return this.saveForm().then(function () {
			return ctl.exec('join', [ token ]);
		}).then(function (res) {
			ctl.show('加入网络', res);
			if (res.code == 0)
				return ctl.exec('restart').then(function () { location.reload(); });
		});
	},

	handleCreate: function () {
		var netName = null;

		return this.commit().then(function () {
			return ctl.prompt('创建网络',
				'网络名只能用小写字母、数字和连字符，例如 <code>home</code>。', 'home');
		}).then(function (name) {
			netName = name;
			if (!name)
				return null;

			return ctl.prompt('创建网络', '填部署信令服务时设的 ADMIN_SECRET。',
				'ADMIN_SECRET', 'password');
		}).then(function (secret) {
			if (!netName || !secret)
				return;

			return ctl.exec('create', [ netName, secret ]).then(function (res) {
				ctl.show('创建网络', res);
				if (res.code == 0)
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
				ctl.show('换新令牌', res);
			});
		});
	},

	handleLeave: function () {
		return ctl.confirm('从网络注销',
			'本机会从成员列表里消失，但令牌和身份保留，随时可以再上线。', '注销').then(function (ok) {
			if (!ok)
				return;

			return ctl.exec('leave').then(function (res) {
				ctl.show('注销', res);
			});
		});
	},

	/* 给 join / create 用：先把当前表单落盘，后面的 CLI 才读得到。
	 * saveForm 失败时 Map.save() 自己弹过错误框了，这里把 reject 直接传出去，
	 * 让 handleJoin 的 then 链停下来 —— 以前静默 catch，worker 没保存也照弹
	 * 令牌框，最后 CLI 只说「先填信令服务器地址」，完全看不出真相。 */
	commit: function () {
		return this.saveForm(null);
	}
});
