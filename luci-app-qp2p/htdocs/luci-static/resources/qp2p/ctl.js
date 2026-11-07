'use strict';
'require fs';
'require ui';

/*
 * 所有和 qp2p 打交道的动作都从这个模块走。
 * 只有一个入口脚本 /usr/libexec/qp2p-ctl，ACL 里也只需要放行它一个。
 */

var CTL = '/usr/libexec/qp2p-ctl';

function run(action, args) {
	return fs.exec(CTL, [ action ].concat(args || [])).then(function (res) {
		return {
			code: res.code || 0,
			stdout: (res.stdout || '').replace(/\s+$/, ''),
			stderr: (res.stderr || '').replace(/\s+$/, '')
		};
	}).catch(function (err) {
		return { code: -1, stdout: '', stderr: String(err && err.message || err) };
	});
}

function runJson(action, args) {
	return run(action, args).then(function (res) {
		var data = null;

		try {
			data = JSON.parse(res.stdout);
		}
		catch (e) {
			return { ok: 0, error: res.stderr || res.stdout || 'qp2p-ctl 输出无法解析', code: res.code };
		}

		if (res.code != 0 && data.ok === undefined)
			data.ok = 0;

		return data;
	});
}

/* 把 CLI 的原始输出丢给用户看（入网、建网、换令牌都是他们想看到的原文） */
function show(title, res) {
	var text = [ res.stdout, res.stderr ].filter(function (s) { return s !== ''; }).join('\n\n');
	var ok = res.code == 0;

	if (!text)
		text = ok ? '完成' : '失败（没有输出）';

	if (ok)
		ui.addNotification(title, E('pre', { 'style': 'white-space:pre-wrap;margin:0;font-family:monospace' }, text), 'info');
	else
		ui.addNotification(title, E('pre', { 'style': 'white-space:pre-wrap;margin:0;font-family:monospace' }, text), 'error');

	return res;
}

/* 危险操作前的确认框，返回 Promise<boolean> */
function confirm(title, message, okLabel) {
	return new Promise(function (resolve) {
		ui.showModal(title, [
			E('p', {}, message),
			E('div', { 'class': 'right' }, [
				E('button', {
					'class': 'btn',
					'click': function () { ui.hideModal(); resolve(false); }
				}, '取消'),
				E('button', {
					'class': 'btn cbi-button cbi-button-apply',
					'click': function () { ui.hideModal(); resolve(true); }
				}, okLabel || '确定')
			])
		]);
	});
}

/* 一个可复制的输入框弹窗，用于粘贴令牌 / 填密钥 */
function prompt(title, message, placeholder, type) {
	return new Promise(function (resolve) {
		var input = E('input', {
			'class': 'cbi-input-text',
			'type': type || 'text',
			'placeholder': placeholder || '',
			'style': 'width:100%'
		});

		ui.showModal(title, [
			E('p', {}, message),
			input,
			E('div', { 'class': 'right', 'style': 'margin-top:1em' }, [
				E('button', {
					'class': 'btn',
					'click': function () { ui.hideModal(); resolve(null); }
				}, '取消'),
				E('button', {
					'class': 'btn cbi-button cbi-button-apply',
					'click': function () {
						var value = input.value.replace(/^\s+|\s+$/g, '');
						ui.hideModal();
						resolve(value || null);
					}
				}, '确定')
			])
		]);

		window.setTimeout(function () { input.focus(); }, 50);
	});
}

return {
	exec: run,
	json: runJson,
	show: show,
	confirm: confirm,
	prompt: prompt,

	/* 本地状态：不发网络请求 */
	state: function () {
		return runJson('state');
	},

	/* 向信令服务刷新一次成员列表；返回 { ok, raw, state } */
	refresh: function () {
		return runJson('refresh');
	},

	log: function (lines) {
		return run('log', [ String(lines || 200) ]).then(function (res) {
			return res.stdout || '';
		});
	}
};
