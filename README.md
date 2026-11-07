# qp2p 的 OpenWrt 包

两个包：

| 目录 | 包名 | 作用 |
|---|---|---|
| `qp2p/` | `qp2p` | 上游静态二进制 + procd 服务 + `/usr/libexec/qp2p-ctl` |
| `luci-app-qp2p/` | `luci-app-qp2p` | LuCI 界面（VPN → qp2p 组网），四个标签页 |

设计前提：**不重新编译 Rust**。包只从 GitHub Releases 取现成的静态二进制，
所以对上游只有一个要求 —— Release 里要有 `qp2p-<版本>-linux-<arch>-static`。

---

## 1. 接进 ponwrt

`feeds.conf` 里加一行：

```
src-git qp2p_feed https://github.com/mylucien/qp2p-openwrt.git
```

本地改代码时用 `src-link` 更省事（指向本仓库的工作副本）：

```
src-link qp2p_feed /path/to/qp2p-openwrt
```

然后：

```sh
./scripts/feeds update qp2p_feed
./scripts/feeds install -a -p qp2p_feed
```

也可以直接把两个目录拷进 `package/`，效果一样。

## 2. 选包

```sh
make menuconfig
#   Network → VPN → qp2p
#   LuCI → 3. Applications → luci-app-qp2p   （选中它会自动带上 qp2p）
```

## 3. 编译

```sh
make package/qp2p/compile V=s
make package/luci-app-qp2p/compile V=s
```

版本是**编译时**从 GitHub API 取的最新 release，缓存 30 分钟：

- 查的是 `/releases?per_page=1`（**不是** `/releases/latest`）——
  上游 CI 每次 push 发的是预发布 `v0.1.2+57`，`latest` 接口会跳过预发布，
  用它就永远取不到新构建。
- 缓存文件：`tmp/.qp2p-latest-tag`，想立刻重新取就删掉它
- 想锁定某个版本：`make package/qp2p/compile QP2P_TAG_FULL=0.1.2`
- 离线编译会直接报错（版本号拿不到），这是有意的

tag 里的 `+57` 是 CI 的构建号：

| tag | `PKG_VERSION` | `PKG_RELEASE` | ipk 文件名 |
|---|---|---|---|
| `v0.1.2+57` | `0.1.2` | `57` | `qp2p_0.1.2-57_aarch64_cortex-a53.ipk` |
| `v0.1.3`（正式版） | `0.1.3` | `1` | `qp2p_0.1.3-1_aarch64_cortex-a53.ipk` |

构建号不进资产名（资产还是 `qp2p-0.1.2-linux-aarch64-static`），但要进
`PKG_RELEASE`，否则两次构建的 ipk 版本完全一样，opkg 不会升级。

架构映射：

| OpenWrt `ARCH` | 下载的资产 |
|---|---|
| `x86_64` | `qp2p-<版本>-linux-x86_64-static` |
| `aarch64_*`（含 `aarch64_cortex-a53`） | `qp2p-<版本>-linux-aarch64-static` |
| 其它 | 编译时明确报错，不会给你一个装不上的包 |

下载后会对着同版本的 `SHA256SUMS.txt` 校验，对不上就停。

> **顺序**：aarch64 的资产是这次才加进上游 CI 的。上游 main 上每次 push 都会发
> 一个带 aarch64 的预发布，所以推完 CI 改动后等那次构建绿了，就能编 ARM 包了。

## 4. 装完怎么用

1. LuCI → **VPN → qp2p 组网 → 设置**
2. 填信令地址（`https://你的-worker`）
3. 点「加入网络…」，粘贴 `qp2p1_…` 令牌（或「创建网络…」填 ADMIN_SECRET 建网）
4. 勾上「启用」，保存并应用
5. 回「概览」看状态，到「成员」看谁连上了

命令行等价操作：

```sh
uci set qp2p.main.worker='https://p2p.example.com'
uci set qp2p.main.enabled='1'
uci commit qp2p
/usr/libexec/qp2p-ctl join qp2p1_home_xxxxxxxx
/etc/init.d/qp2p restart
/usr/libexec/qp2p-ctl state      # JSON 状态，LuCI 用的就是它
```

## 5. 配置存在哪

只有一处用户配置，但物理上有两份文件，职责分开：

| 文件 | 内容 | 谁写 |
|---|---|---|
| `/etc/config/qp2p` | 信令地址、名字、MTU、路由、防火墙开关… | LuCI / uci |
| `/etc/qp2p/config.toml` | 上面这些 + 加入令牌、网络 id、虚拟地址 | `qp2p-ctl apply`（调 `qp2p config set`），以及 `qp2p join` |

规则是 **UCI 是唯一来源**：每次服务启动都会先跑一遍 `qp2p-ctl apply`，
把 UCI 里的值同步进 `config.toml`。所以手改 `config.toml` 会在下次重启时被覆盖。

令牌、私钥、证书只存在 `/etc/qp2p/`（目录 0700、文件 0600），**不写进 UCI**，
避免同一个密钥在 `/etc/config` 和 `/etc/qp2p` 里各躺一份。

## 6. 路由器当网关时的两个开关

`qp2p0` 是 qp2p 自己建的网卡，netifd 不管它，所以防火墙要单独下发：

- **允许局域网访问 qp2p**（默认开）
  建 `qp2p` zone（`device qp2p0`）、放通 LAN → qp2p、并 masquerade。
  masq 是必需的：内网设备 `192.168.1.10` 去访问 `10.78.x.y` 时，
  源地址要换成路由器自己的虚拟地址，否则对端回包没路由。

- **允许对端访问局域网**（默认关）
  放通 qp2p → LAN，并给「隧道网段 → 非隧道网段」的流量补一条 SNAT。
  这条不能靠 zone 上的 `masq` 实现（那个只管出这个 zone 的方向），
  所以生成 `/usr/share/nftables.d/ruleset-post/10-qp2p.nft` 交给 fw4 一起加载。

- **额外路由** 就是 `--route`，本机要访问对端身后网段时填对端那边的网段。

## 7. 已知限制

1. **没有结构化状态**。`qp2p status` 输出的是给人看的表格，`up` 的输出是日志。
   `qp2p-ctl` 只能解析文本：
   - 成员表：按「候选数 → IP → 名字」的顺序切，能处理「离线12 分钟」这种带空格的状态
   - 延迟（rtt）：只能从 `logread` 里的「✓ 直连已建立：name (ip) rtt=x ms」反推，
     日志被刷掉就没有数字，界面会显示 `—`

   要根治得给 CLI 加 `--json`（`status --json` / 运行期状态文件），
   那是上游的事，这里没动。
2. **单实例**。一台路由器同时只跑一个网络（`config.toml` 就是一个网络）。
3. **`peer_to_lan` 的 nft 规则**只在服务启动时下发；改完设置要「保存并应用」，
   或者手动 `/usr/libexec/qp2p-ctl firewall`。
4. **界面只有中文**，没做 po 翻译文件。
5. 上游 `qp2p up` 不处理 `SIGTERM`，被 procd 停掉时来不及给服务端发下线通知，
   对端要等约 2 分钟才把它标成离线。

## 8. 验收清单

在路由器上（aarch64 包编好并刷进去之后）：

```sh
# 1. 二进制能跑
qp2p -V

# 2. 服务起来了，网卡在
/etc/init.d/qp2p start
ip link show qp2p0
logread | grep qp2p | tail

# 3. 状态接口吐的是合法 JSON
/usr/libexec/qp2p-ctl state | jsonfilter -e '@.running'

# 4. 成员能被解析出来（有第二台设备 join 之后）
/usr/libexec/qp2p-ctl refresh | jsonfilter -e '@.state.peers[*].name'

# 5. 防火墙 zone 建好了
uci show firewall | grep qp2p

# 6. 内网设备能 ping 通对端虚拟地址
ping 10.78.x.y
```

LuCI 侧：四个标签页都能打开，概览的数字会跟着服务状态变，
「成员」刷新能出表格，「日志」能滚。
